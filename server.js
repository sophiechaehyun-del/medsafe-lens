import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const PORT = process.env.PORT || 3000;
const ROOT = dirname(fileURLToPath(import.meta.url));
if (!KEY) console.warn("ANTHROPIC_API_KEY is not set: the page loads, but label reading and interaction checks will be unavailable.");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // correct client IPs behind Render's proxy (used by the rate limit)
app.use(express.json({ limit: "25mb" }));

// Only the page itself is served (no directory listing, server files stay private)
app.get("/", (req, res) => res.sendFile(join(ROOT, "index.html")));
app.get("/healthz", (req, res) => res.json({ ok: true, ai: Boolean(KEY) }));

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
  const { prompt, images = [] } = req.body || {};
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
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, messages: [{ role: "user", content }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: j.error?.message || "Upstream error" });
    res.json({ text: j.content.filter(b => b.type === "text").map(b => b.text).join("") });
  } catch { res.status(502).json({ error: "Upstream unreachable" }); }
});

// Real drug-label excerpts from openFDA (https://open.fda.gov/apis/drug/label/)
// The page may send label text such as "Ibuprofen USP, 200 mg in each tablet": strip strengths,
// dosage forms and salt words, then try the cleaned phrase and finally the first ingredient alone.
const NOISE = new Set("usp ip bp mg mcg ml tablet tablets capsule capsules caplet caplets each per in and with of the oral film coated extended delayed release hcl hydrochloride sodium potassium calcium magnesium".split(" "));
async function fdaLabel(term) {
  const q = encodeURIComponent(`"${term}"`);
  const r = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:${q}+openfda.substance_name:${q}&limit=1`);
  if (!r.ok) return null;
  return (await r.json()).results?.[0] || null;
}
app.get("/api/fda", async (req, res) => {
  const words = String(req.query.name || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !NOISE.has(w)).slice(0, 3);
  if (!words.length) return res.json({});
  try {
    let l = null;
    for (const term of [...new Set([words.join(" "), words[0]])]) { l = await fdaLabel(term); if (l) break; }
    if (!l) return res.json({});
    const cut = a => (a ? String(a[0]).slice(0, 700) : "");
    res.json({ interactions: cut(l.drug_interactions), warnings: cut(l.boxed_warning || l.warnings) });
  } catch { res.json({}); }
});

app.listen(PORT, () => console.log(`MedSafe Lens running at http://localhost:${PORT}`));
