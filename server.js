import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = process.env.ANTHROPIC_API_KEY;
// Models the page may choose from; anything else falls back to the default (MODEL env var, else Haiku)
const ALLOWED_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"];
const MODEL = ALLOWED_MODELS.includes(process.env.MODEL) ? process.env.MODEL : "claude-haiku-5-5";
const PORT = process.env.PORT || 3000;
const ROOT = dirname(fileURLToPath(import.meta.url));
if (!KEY) console.warn("ANTHROPIC_API_KEY is not set: the page loads, but label reading and interaction checks will be unavailable.");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // correct client IPs behind Render's proxy (used by the rate limit)
app.use(express.json({ limit: "25mb" }));

// Only the page itself is served (no directory listing, server files stay private)
app.get("/", (req, res) => res.sendFile(join(ROOT, "index.html")));
app.get("/healthz", (req, res) => res.json({ ok: true, ai: Boolean(KEY), defaultModel: MODEL, models: ALLOWED_MODELS }));

// Tiny in-memory rate limit: 15 requests / minute / IP.
const hits = new Map();
app.use("/api", (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 15) return res.status(429).json({ error: "Too many requests" });
  recent.push(now); hits.set(req.ip, recent); next();
});

// Proxy to the Claude API. The key never reaches the browser.
app.post("/api/sample", async (req, res) => {
  if (!KEY) return res.status(503).json({ error: "The AI service is not configured on this server (ANTHROPIC_API_KEY missing)." });
  const { prompt, images = [], model } = req.body || {};
  const useModel = ALLOWED_MODELS.includes(model) ? model : MODEL;
  const okType = t => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(t);
  if (typeof prompt !== "string" || prompt.length > 20000 || !Array.isArray(images) || images.length > 6)
    return res.status(400).json({ error: "Bad request" });
  const content = [
    ...images.filter(i => okType(i.type)).map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })),
    { type: "text", text: prompt }
  ];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: useModel, max_tokens: 4000, messages: [{ role: "user", content }] })
    });
    const raw = await r.text();
    let j; try { j = JSON.parse(raw); } catch { return res.status(502).json({ error: "The AI service returned an unreadable reply. Please try again." }); }
    if (!r.ok) return res.status(r.status).json({ error: j.error?.message || "Upstream error" });
    res.json({ model: useModel, stop: j.stop_reason, text: (j.content || []).filter(b => b.type === "text").map(b => b.text).join("") });
  } catch { res.status(502).json({ error: "Upstream unreachable" }); }
});

// Real drug-label excerpts from openFDA (https://open.fda.gov/apis/drug/label/)
// Accepts label text such as "Ibuprofen USP, 200 mg in each tablet" or "amlodipine and atorvastatin":
// strips strengths, dosage forms and salt words, maps international names to U.S. names, then tries
// all ingredients together, the cleaned phrase, and finally the first ingredient alone.
const NOISE = new Set("usp ip bp mg mcg ml tablet tablets capsule capsules caplet caplets each per in and with of the oral film coated extended delayed release hcl hydrochloride sodium potassium calcium magnesium".split(" "));
const SYNONYMS = { paracetamol: "acetaminophen", salbutamol: "albuterol", levosalbutamol: "levalbuterol", glibenclamide: "glyburide",
  frusemide: "furosemide", adrenaline: "epinephrine", noradrenaline: "norepinephrine", lignocaine: "lidocaine", pethidine: "meperidine",
  rifampicin: "rifampin", thyroxine: "levothyroxine", amoxycillin: "amoxicillin", cefalexin: "cephalexin", ciclosporin: "cyclosporine",
  colecalciferol: "cholecalciferol", dicycloverine: "dicyclomine", mesalazine: "mesalamine", phenobarbitone: "phenobarbital",
  aciclovir: "acyclovir", valaciclovir: "valacyclovir", chlorphenamine: "chlorpheniramine", isoprenaline: "isoproterenol" };
const fdaCache = new Map();
async function fdaSearch(search) {
  const r = await fetch(`https://api.fda.gov/drug/label.json?search=${search}&limit=1`);
  if (!r.ok) return null;
  return (await r.json()).results?.[0] || null;
}
const byName = t => { const q = encodeURIComponent(`"${t}"`); return `openfda.generic_name:${q}+openfda.substance_name:${q}`; };
const allOf = ws => ws.map(w => { const q = encodeURIComponent(`"${w}"`); return `(openfda.generic_name:${q}+openfda.substance_name:${q})`; }).join("+AND+");
const text = (l, ...keys) => { for (const k of keys) if (l[k]?.length) return String(l[k].join(" ")).replace(/\s+/g, " ").replace(/^(\d+(\.\d+)*\s+)?[A-Z][A-Z &/,()-]{3,60}\s+(?=[A-Z][a-z])/, "").trim(); return ""; };
const cut = (t, n = 700) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + " …" : t);
app.get("/api/fda", async (req, res) => {
  const words = String(req.query.name || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !NOISE.has(w)).map(w => SYNONYMS[w] || w).slice(0, 3);
  if (!words.length) return res.json({});
  const key = words.join(" ");
  try {
    let l = fdaCache.get(key);
    if (l === undefined) {
      const tries = [];
      if (words.length > 1) tries.push(allOf(words));
      tries.push(byName(key)); if (words.length > 1) tries.push(byName(words[0]));
      l = null;
      for (const t of tries) { l = await fdaSearch(t); if (l) break; }
      fdaCache.set(key, l); if (fdaCache.size > 500) fdaCache.delete(fdaCache.keys().next().value);
    }
    if (!l) return res.json({});
    const out = { interactions: cut(text(l, "drug_interactions")), warnings: cut(text(l, "boxed_warning", "warnings", "warnings_and_cautions")) };
    if (req.query.full) {
      const o = l.openfda || {};
      Object.assign(out, {
        product: [o.brand_name?.[0], o.generic_name?.[0] && `(${o.generic_name[0].toLowerCase()})`, o.manufacturer_name?.[0] && `— ${o.manufacturer_name[0]}`].filter(Boolean).join(" "),
        purpose: cut(text(l, "indications_and_usage", "purpose"), 500),
        directions: cut(text(l, "dosage_and_administration", "directions"), 500),
        storage: cut(text(l, "storage_and_handling", "how_supplied"), 300),
        source: l.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(l.set_id)}` : ""
      });
    }
    res.json(out);
  } catch { res.json({}); }
});

app.listen(PORT, () => console.log(`MedSafe Lens running at http://localhost:${PORT}`));
