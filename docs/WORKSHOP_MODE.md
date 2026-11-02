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
| `ADMIN_USERNAME` | the admin user name you choose |
| `ADMIN_PASSWORD_HASH` | printed by `npm run hash-password` |
| `ADMIN_AUTH_SECRET` | printed by `npm run hash-password` (32+ random characters) |
| `FRONTEND_ORIGIN` | `https://maninka123.github.io` (comma-separate more origins if needed) |

Mark them for Production, then **Redeploy** so they take effect. Never put these in Git; `.env*` files are ignored.

### 6. Tell the student app where the backend is
In GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**
`WORKSHOP_API_URL` = `https://<your-project>.vercel.app` (no trailing slash). It is a public address, not a secret.
Then re-run the **Deploy to GitHub Pages** workflow once. After this, you never redeploy for a workshop.

### 7. Open the dashboard
Go to `https://<your-project>.vercel.app/admin` and sign in with your username and password (the root address has a faint "admin" link at the bottom right). After the first sign-in, press **Set up a passkey**: the browser offers Touch ID or Face ID on Apple devices, Windows Hello on Windows, your phone, or a security key. From then on **Sign in with a passkey** replaces typing the password (the password keeps working). Only a public key is stored, and a passkey signs in with the same 8-hour session as a password.

## Running a workshop

**Start:** open `/admin` and press **3 hours / 6 hours / 1 day / 2 days** (or pick Sydney-time dates). Access is open by default: while it runs, anyone in the lab can use the AI steps with no key and no code, and each browser is counted as an anonymous user.

**While it runs:** the dashboard refreshes every 5 seconds. Extend or shorten with **+1 h / +3 h / +1 day / −1 h** or an exact end time. **Turn off AI access** ends it at once.
* **Live monitor** (right column): users using the AI now, requests per minute, a 30-minute chart (answered, held back, failed), answer time, health lights (database, DeepSeek, AI access, student website, GitHub status, failures), capacity left (requests, users, DeepSeek credit and roughly how many requests it pays for) and why requests were held back. A 429 or 503 from the student site means GitHub Pages is slowing visitors down.
* **On / Off** is the shared AI access only: the lab works without it.
* It cannot see the website's own traffic, and it keeps no prompts, answers, names or addresses.

**Limits:** *Requests per user*, *Total requests* and *Max users* (defaults 40, 1,500, 100; *Unlimited* for users). Raise any of them while it runs, using the Limits card or the **+100 / +500 / +10 / +25** buttons. Built in: a per-minute rate limit per user and per network address, a cap on users per address, and a hard ceiling on tokens per request.

**Access codes (optional):** switch *Access* to **Codes** for a smaller or untrusted group. Codes are shown once and stored only as keyed hashes.

**After:** it ends by itself at the end time and the lab returns to bring-your-own-key. Then revoke the dedicated DeepSeek key and, if you like, **Delete user records**.

**Cost:** estimated from DeepSeek's advertised `deepseek-flash` prices (what `deepseek-v4-flash` is billed as): $0.15 per 1M input tokens ($0.003 on cache hits) and $0.60 per 1M output, double at peak (01:00–04:00 and 06:00–10:00 UTC, Mon–Fri). Source and date are in the dashboard and `workshop-backend/lib/pricing.ts`; check them at https://api-docs.deepseek.com/quick_start/pricing/. Chinese public holidays are ignored.

**Budget without codes:** two browsers on one network can't be told apart from an abuser, so set **Total requests** to what you are happy to pay (1,500 requests cost roughly $1 or less) and watch the spend tile.

## Student analytics (privacy-conscious)

The dashboard's **Students** section shows who has joined and what they have used:

* totals: users joined, users active now (activity in the last 10 minutes), AI requests, tokens and spend so far;
* a table with each student's name (or code label), approximate city and country, first joined, last active, requests (and how many are left), tokens and estimated cost. Cost per user is computed per request from DeepSeek's advertised prices.

What is collected, and only for people who enter a workshop code (nothing about visitors who just use the lab):

| Kept | How |
|---|---|
| Optional display name | typed by the student when entering the code (30 characters) |
| Approximate city and country | from Vercel's edge geolocation headers; no coordinates |
| Joined / last-active times, request and token counts | counted by the backend |

**Not kept:** IP addresses (they are never stored; a short-lived one-way tag is used only for rate limiting and expires within minutes), prompts, answers, or browser identifiers. Students see a notice next to the code box describing exactly this.

**Deleting:** nothing is deleted automatically. When you are done, press **Delete user records** on the dashboard to remove the names, places, usage and codes of the current workshop.

## What protects your key and budget

* The DeepSeek key exists only in Vercel's environment. The student app never receives it, and it is not in Git, the build, responses, errors or logs. The backend only forwards chat requests with a fixed model (`deepseek-v4-flash`), message-shape checks, a size limit (about 450 KB), a capped `max_tokens`, and a 55 s timeout. It is not an open proxy.
* Per-student and workshop-wide request caps, a per-minute rate limit, and an optional token budget (with reservations for requests in flight) are enforced with atomic Redis counters, so simultaneous requests cannot exceed them. They are tied to the code, not to the browser, so clearing storage or opening more tabs does not help.
* If DeepSeek fails, the student's request is not counted. If Redis or the backend is down, AI requests are refused (fail closed) while the offline lab keeps working.
* Admin login uses a username, a salted scrypt password hash, optional passkeys (Touch ID, Face ID, Windows Hello or a security key, bound to the site name), a signed `HttpOnly; Secure; SameSite=Strict` session cookie that lasts 8 hours, a CSRF token and an origin check on every change, and login throttling (5 tries per address per 15 minutes). There is no registration and no default password.
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


## Challenge scores (separate from AI access)

The admin page has a second tab, **Challenge scores**. Switch **Receiving scores** on (unlimited, or for a number of hours or days) and students can send the score of the Industrial Digital Twin Challenge with their name and index number. It does not depend on AI access being on. See [DIGITAL_TWIN_CHALLENGE.md](DIGITAL_TWIN_CHALLENGE.md).
