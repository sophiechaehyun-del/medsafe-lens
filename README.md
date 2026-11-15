# MedSafe Lens

Photo-based drug–food interaction checker with plain-language explanations.
Take a photo of a medicine label; the app reads it with Claude, explains it in plain language,
checks interactions with foods and your other medicines, and adds real excerpts from the
openFDA drug-label database.

> **Not medical advice.** The AI can misread labels or miss interactions. Always confirm with a pharmacist or doctor.

## Live demo

**https://YOUR-SERVICE.onrender.com** — hosted on Render's free plan. If it has been idle, the first load can take about a minute while the server wakes up.

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

Optional environment variables: `MODEL` (default `claude-sonnet-5-5`), `PORT` (default `3000`).
Without a key the page still loads, but label reading and interaction checks are disabled.

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render: **New → Blueprint** (uses `render.yaml`) or **New → Web Service** with
   build command `npm install` and start command `npm start`.
3. Add the environment variable `ANTHROPIC_API_KEY` in the Render dashboard.

## How it works

| File | Purpose |
|---|---|
| `index.html` | The whole UI: label scanner, My Meds, interaction checker, read-aloud |
| `server.js` | Serves the page, keeps the API key on the server, proxies prompts/images to Claude, fetches openFDA label excerpts |
| `render.yaml` | One-click Render deployment settings |

- The API key never reaches the browser.
- "My Meds" is stored only in the browser's localStorage.
- `/api` is rate-limited to 15 requests per minute per IP.

## Before real-world use

- Add authentication and a production-grade rate limiter; serve over HTTPS.
- Don't log images or medication lists. Identifiable health data needs a compliance review (HIPAA/GDPR).
- Have a pharmacist or clinician review outputs; consider cross-checking against RxNorm/DrugBank.
