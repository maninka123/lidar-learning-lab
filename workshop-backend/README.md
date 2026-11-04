# Workshop backend

The small Vercel service behind **Workshop Mode** of the LiDAR Learning Lab: it lets students in a live workshop use the AI steps with a personal access code, without their own DeepSeek keys, for a limited time.

- **Admin dashboard** (`/admin`): start, schedule, extend or stop a workshop; set two limits; choose open access or personal codes; see who joined, live usage and spend. Sign in with username and password, or a passkey (Touch ID, Face ID, Windows Hello) once set up.
- **API** (`/api/...`): checks codes, enforces quotas and expiry on the server, and forwards chat requests to DeepSeek. The DeepSeek key lives only in Vercel's environment variables.
- **Feedback**: anonymous student feedback from the Thank You tab (`POST /api/student/feedback`) and the admin **Feedback & Insights** tab (summary, list, CSV export, delete). See `docs/FEEDBACK.md`.
- **Data**: Upstash Redis (settings, codes, usage, feedback). Participant records stay until the instructor deletes them from the dashboard.

Live: <https://lidar-learning-lab-workshop-backend.vercel.app> · deployed from this folder (Vercel root directory `workshop-backend`) on every push to `main`.

```bash
npm install
npm test                      # 61 tests
ADMIN_USERNAME=me ADMIN_PASSWORD=choose-one npm run dev   # local copy with an in-memory store: http://localhost:8787/admin
npm run hash-password         # make ADMIN_PASSWORD_HASH for Vercel
```

Environment variables (Vercel → Settings): `DEEPSEEK_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_AUTH_SECRET`, `FRONTEND_ORIGIN`, plus the Redis pair added by the Upstash integration. Full guide: [../docs/WORKSHOP_MODE.md](../docs/WORKSHOP_MODE.md).

### Mission summaries

New challenge submissions optionally include a bounded `missions` array (up to seven entries): mission number, `status`, score 0–100, attempt count and completion flag. The administration details and CSV include these summaries. Older submissions without this property remain readable. Grades and mission status are calculated in the browser and are not tamper-proof.
