# Thank You tab, student feedback and Feedback & Insights

The last tab of the lab (**Thank You**) closes the learning journey and invites an optional, anonymous feedback form. The admin page turns the answers into charts and a table.

It runs on the same backend as Workshop Mode and the challenge scores (Vercel functions + Upstash Redis). It needs **no access code and no AI key**, and it works whether or not a workshop is running.

## What students see

- A dark, calm page with a slowly turning point-cloud scene (canvas 2D, no WebGL context; still when "reduce motion" is on).
- **Share Your Feedback** opens a form in the page (never automatically, never forced) and **Explore the Lab Again** goes to the first tab (the intro does not replay).
- The form: three Before / After understanding questions (1 to 5, nothing pre-selected, equal or lower After ratings allowed), how helpful the simulations were (1 to 5), the most useful part (dropdown) and an optional suggestion (up to 1,000 characters).
- Sending shows a loading state; only a confirmed save shows the thank-you message. A failure keeps every answer and offers **Try again**. Each form has one random id, so a double click or a retry is stored once.
- No name, email, account or browser id is asked for or sent. The body holds the ratings, the module, the comment and that form id.

## What is stored

One record per response, newest first, in Redis under `fb:list` (the newest 5,000 are kept):

| field | meaning |
|---|---|
| `id` | random 12 hex characters |
| `at` | submission time (UTC ms) |
| `before`, `after` | three ratings 1 to 5 each, in the order LiDAR / processing / applications |
| `helpful` | 1 to 5 |
| `module` | a stable id (see `MODULES` in `workshop-backend/lib/feedback.ts`) |
| `text` | optional comment, control characters removed |
| `version` | optional app version |

The server **never** stores IP addresses, location or browser ids with feedback. The network address is used only, as a one-way hash, for the rate limit (12 responses per address per hour) and is not kept with the record. Comments and answers are not written to logs.

Retention: the newest 5,000 responses are kept. Deleting a response (or all of them) removes it from Redis, so it disappears from the charts and every later export.

## Endpoints

Public (the student app, CORS limited to `FRONTEND_ORIGIN`):

- `POST /api/student/feedback` : validate strictly (all six ratings 1 to 5, a known module, text at most 1,000 characters), apply the rate limit and the form id, store. Answers `{ ok, duplicate }`.

Admin (signed-in session, CSRF token on every change):

- `GET /api/admin/feedback?page=&pageSize=&sort=new|old&from=&to=&module=&helpful=&q=` : one page of responses (pageSize at most 100) plus the module list.
- `GET /api/admin/feedback-summary` : all numbers behind the charts.
- `GET /api/admin/feedback-export?…same filters…` : `{ csv, count }`. Without filters it is every response.
- `POST /api/admin/feedback-delete` `{ ids: [...] }` : delete one or several.
- `POST /api/admin/feedback-clear` `{ confirm: "DELETE" }` : delete everything.

## Feedback & Insights (admin page)

The third tab of the admin page.

- **Overview**: responses, average helpfulness, average Before, average After, average change. With no responses an empty state is shown (no example numbers).
- **Before and after**: a grouped bar chart and a table per area (responses, mean before, mean after, average change, share improved / unchanged / decreased) and overall. The change is After − Before **for each student's own pair**; zero and negative values count. The numbers are labelled *self-reported*. Rating distributions (1 to 5) are in an expandable section.
- **Simulation helpfulness**: average, share rating 4 or 5, distribution.
- **Most useful part**: a ranked bar chart with counts and shares. A module id that no longer exists is kept and shown as "<id> (retired)".
- **Trend and words**: submissions per day (UTC) and the most repeated words in comments. This is a plain count, not an AI summary, and no comment leaves the server.
- **Individual responses**: search the suggestions, filter by module, helpfulness and date, sort, page through, open a response for the full detail, delete one (with a confirmation naming it), select several and delete them, **Export filtered** or **Export all** as CSV. **Delete all feedback** sits in a collapsed danger zone and needs the word DELETE typed.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an apostrophe so a spreadsheet never runs them as formulas. The CSV holds the date, the ratings, the changes, helpfulness, the module and the suggestion: nothing else.

## Keeping the module list right

The dropdown on the Thank You page (`src/feedback/model.ts`) and the server list (`workshop-backend/lib/feedback.ts`) hold the same ids and labels. A unit test fails if they differ. To rename a tab's label, change both; to retire a module, remove it from the dropdown only: old records keep their id and show as retired.

## Deployment

Nothing new is needed: the existing `FRONTEND_ORIGIN`, Upstash and admin settings are used, and the student build uses the same `VITE_WORKSHOP_API_URL` as the challenge. If that address is not set, the form says feedback sending is not set up and never reports success.

## Tests

- `cd workshop-backend && npm test` : `tests/feedback.test.ts` (submission, validation, duplicates, rate limit, origin, admin protection, filters and paging, summary numbers, deletion, CSV).
- `npm test` in the root : `tests/feedback.test.ts` (form model, payload, sending states, module list in step with the server).
- `npm run test:e2e` : the Thank You tab, the form, keyboard use, failure and retry, and a double click (a second build with a mocked lab server runs on port 4174).
