# MedSafe Lens

Photo-based drug–food interaction checker with plain-language explanations.
Take a photo of a medicine label: the photo is sent (through this server) to Claude, which reads the label and
explains the medicine in plain language, together with the matching official FDA label information. You can
also check interactions between your medicines and foods.

> **Not medical advice.** The AI can misread labels or miss interactions. Always confirm with a pharmacist or doctor.

## Live demo

**https://medsafe-lens.onrender.com** — hosted on Render's free plan. If it has been idle, the first load can take about a minute while the server wakes up.

## Run it locally

Requires [Node.js 18+](https://nodejs.org) and an [Anthropic API key](https://console.anthropic.com).

```bash
npm install
# macOS / Linux
export ANTHROPIC_API_KEY=your_key_here
# Windows PowerShell
$env:ANTHROPIC_API_KEY="your_key_here"
npm start            # → http://localhost:3000
```

Optional environment variables: `MODEL` — default model, `claude-haiku-5-5` (default) or `claude-sonnet-5-5`, `PORT` (default `3000`).
Without a key the page still loads, but label reading and interaction checks are disabled.

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render: **New → Blueprint** (uses `render.yaml`) or **New → Web Service** with
   build command `npm install` and start command `npm start`.
3. Add the environment variable `ANTHROPIC_API_KEY` in the Render dashboard.

## How it works

1. **AI label reading:** as soon as a photo is uploaded it is resized in the browser and sent via this server to
   Claude (Haiku 5.5 by default, Sonnet 5.5 selectable), which reads the label and returns a plain-language
   summary: what it is for, how to take it, food and alcohol cautions, warnings and when to get help.
2. **FDA label lookup:** the ingredient name (text only) is matched to the public openFDA drug-label database
   to show uses, directions, warnings, interactions and storage next to the AI summary.
3. **Interaction checker:** Claude checks the saved medicines against foods and drinks.

| File | Purpose |
|---|---|
| `index.html` | The whole UI: photo upload, AI label reading, FDA info, My Meds, interaction checker, read-aloud |
| `server.js` | Serves the page, keeps the API key on the server, proxies AI requests to Claude, fetches openFDA label data |
| `render.yaml` | One-click Render deployment settings |

- The API key never reaches the browser; photos are sent to Claude only through this server and are not stored.
- "My Meds" is stored only in the browser's localStorage.
- `/api` is rate-limited to 15 requests per minute per IP.
- The **AI model** menu in the top bar switches between Claude Haiku 5.5 (default, fast and low-cost) and Claude Sonnet 5.5 (more accurate on hard-to-read labels). The choice is remembered on the device; the server accepts only these two models.

## Before real-world use

- Add authentication and a production-grade rate limiter; serve over HTTPS.
- Don't log images or medication lists. Identifiable health data needs a compliance review (HIPAA/GDPR).
- Have a pharmacist or clinician review outputs; consider cross-checking against RxNorm/DrugBank.
