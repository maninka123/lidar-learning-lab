# Workshop Mode

Lets students in a live workshop use the AI features **without their own DeepSeek keys**, for a limited time, with limits you control from a private dashboard. When the time is up it switches itself off.

```
Students ── GitHub Pages (the LiDAR Lab, unchanged) ──► asks the backend "is a workshop on?"
                    │  access code
                    ▼
        Vercel backend (workshop-backend/)  ──►  DeepSeek (your dedicated key lives here only)
                    ▲
        /admin dashboard (you, password login)        Upstash Redis = settings, codes, usage
```

* The **student app** stays on GitHub Pages at its current address. It has no admin pages or controls.
* The **backend and dashboard** are a separate Vercel project built from the `workshop-backend/` folder.
* If no backend address is set, or the backend is unreachable, the lab behaves exactly as it does today (students paste their own key).

## One-time setup (about 20 minutes)

### 1. Create a dedicated DeepSeek key
In the DeepSeek platform, create a **new** API key just for workshops (name it e.g. `workshop`). Top up only what you are willing to spend. Do not reuse your personal key. You will revoke it after the workshop.

### 2. Create the Vercel project
1. Merge the `workshop-mode` branch into `main` (or choose that branch as the Production Branch in Vercel).
2. In Vercel: **Add New → Project**, import `maninka123/lidar-learning-lab`.
3. Set **Root Directory** to `workshop-backend`. Framework preset: **Other**. Deploy.
   This does not touch GitHub Pages: Pages keeps building the repository root.

### 3. Add the database
In the Vercel project: **Storage → Create Database → Upstash Redis** (Marketplace; the free plan is plenty). Connect it to the project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically, and the backend reads those names.

### 4. Choose your admin password
On your computer, in the `workshop-backend` folder:

```bash
npm install
npm run hash-password
```

Type a password (12+ characters). It prints two lines: `ADMIN_PASSWORD_HASH=…` and `ADMIN_AUTH_SECRET=…`. Only a one-way hash is stored; the password itself is never saved anywhere.

### 5. Environment variables (Vercel → Settings → Environment Variables)

| Name | Value |
|---|---|
| `DEEPSEEK_API_KEY` | the dedicated workshop key |
| `ADMIN_PASSWORD_HASH` | printed by `npm run hash-password` |
| `ADMIN_AUTH_SECRET` | printed by `npm run hash-password` (32+ random characters) |
| `FRONTEND_ORIGIN` | `https://maninka123.github.io` (comma-separate more origins if needed) |

Mark them for Production, then **Redeploy** so they take effect. Never put these in Git; `.env*` files are ignored.

### 6. Tell the student app where the backend is
In GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**
`WORKSHOP_API_URL` = `https://<your-project>.vercel.app` (no trailing slash). It is a public address, not a secret.
Then re-run the **Deploy to GitHub Pages** workflow once. After this, you never redeploy for a workshop.

### 7. Open the dashboard
Go to `https://<your-project>.vercel.app/admin` and log in. Anyone can open that page, but without the password nothing works, and all admin actions are checked on the server.

## Running a workshop

**Before**
1. Log in at `/admin`.
2. **Limits**: set requests per student, total requests, max output tokens, requests per minute, an optional token budget, and the number of students. Click *Save limits*. Add DeepSeek's current prices if you want a spend estimate.
3. **Start a workshop**: pick *3 hours / 6 hours / 1 day / 2 days* to start now, or enter a start and end date (Australia/Sydney time) and press *Schedule*.
4. **Student access codes**: choose how many, press *Generate*, then *Copy all* or *Download CSV* and hand one code to each student. Codes are shown once and cannot be recovered later (only a keyed hash is stored). Generate more any time, up to the student limit.

**During**
* Students open the normal lab address, go to an AI step, and enter their code where the key box used to appear (it only appears while a workshop is running). They can still choose "Use my own DeepSeek key instead".
* The dashboard refreshes every 15 seconds: remaining time, active students, requests used and left, tokens, estimated spend, per-student usage and recent errors.
* **Extend or shorten**: *+1 h / +3 h / +1 day / −1 h*, or set an exact end time.
* **Revoke one student**: *Revoke* next to their name.
* **Stop immediately**: *Turn off now*. Every code stops working at once.

**After**
* The workshop ends by itself at the end time. The server checks the time on **every** request, so nothing depends on a timer or a scheduled job. All codes stop working, the dashboard shows *Expired*, and the lab goes back to bring-your-own-key.
* Starting a new workshop after one has expired creates a fresh one: new codes are needed and the counters start from zero.
* **Revoke the dedicated DeepSeek key** in the DeepSeek platform, and optionally delete `DEEPSEEK_API_KEY` from Vercel.
* **Check normal behaviour**: open the lab, go to *Scene Graphs & 3D AI*. No code box should appear, and the AI step should ask for your own key as before. Everything offline works throughout.

## What protects your key and budget

* The DeepSeek key exists only in Vercel's environment. The student app never receives it, and it is not in Git, the build, responses, errors or logs. The backend only forwards chat requests with a fixed model (`deepseek-v4-flash`), message-shape checks, a size limit (about 450 KB), a capped `max_tokens`, and a 55 s timeout. It is not an open proxy.
* Per-student and workshop-wide request caps, a per-minute rate limit, and an optional token budget (with reservations for requests in flight) are enforced with atomic Redis counters, so simultaneous requests cannot exceed them. They are tied to the code, not to the browser, so clearing storage or opening more tabs does not help.
* If DeepSeek fails, the student's request is not counted. If Redis or the backend is down, AI requests are refused (fail closed) while the offline lab keeps working.
* Admin login uses a salted scrypt password hash, a signed `HttpOnly; Secure; SameSite=Strict` session cookie that lasts 8 hours, a CSRF token and an origin check on every change, and login throttling (5 tries per address per 15 minutes). There is no registration and no default password.
* Prompts and answers are never stored or logged. Errors are logged by type and status only.
* Only the student site's origin(s) in `FRONTEND_ORIGIN` are allowed by CORS.

## Costs
Vercel's free plan and Upstash's free plan are enough for a class. DeepSeek charges per token; the dashboard's estimate needs the prices you enter under *Limits*. Set a token budget as a hard stop.

## Local testing
```bash
cd workshop-backend
cp .env.example .env.local      # fill DEEPSEEK_API_KEY only; the dev server makes its own admin login and in-memory store
ADMIN_PASSWORD='choose-a-password' npm run dev    # http://127.0.0.1:8787/admin
```
Then in the repository root add `VITE_WORKSHOP_API_URL=http://127.0.0.1:8787` to `.env.local` and run the student app with `npm run dev`. In this mode `localhost` origins are allowed; this never applies in production.

Tests: `cd workshop-backend && npm test` (backend) and `npm test` in the root (student app).
