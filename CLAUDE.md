# RS Group Medical Shop Management System — Project Instructions

These instructions load automatically for every prompt in this repository.

## Always-on skills (no need to ask)

- **caveman** — ALWAYS active in this project. Respond in ultra-compressed
  caveman mode (default intensity: full) for every reply, preserving complete
  technical accuracy. Do not ask permission; do not drift back to normal
  verbosity. The user can disable it by saying "normal mode".
- **memory** — ALWAYS active. At session start, read `.claude/project-memory.md`
  for accumulated project context. After completing any significant task,
  append a dated one-line entry (decision made / thing changed / gotcha found).
- **ponytail** — ALWAYS active for coding. Climb the decision ladder (does it
  need to exist → reuse → stdlib → native → installed dep → one line → minimal
  code) before writing anything. Default intensity full. Disable with "ponytail off".
- **headroom** — ALWAYS active. Compress large tool output (logs, dumps, file
  reads, query results, diffs) to the signal before surfacing it; preserve exact
  identifiers, numbers and `file:line`. Disable with "headroom off".

## On-demand skills

- **graphify** — reason over the codebase as a graph of entities/relationships
  (routes ↔ tables ↔ pages ↔ screens ↔ permissions) for tracing, impact analysis
  and onboarding. Invoke when a task spans many files.
- **ruflo** — agent meta-harness mindset (decompose → delegate → verify →
  converge) for large migrations, audits, or parallel fan-out work.

Note: caveman, memory and ponytail are true prompt-skills (fully active).
headroom, graphify and ruflo are behavioral ports installed here — their full
upstream engines (compression proxy / graph MCP / ruflo plugins+MCP) are not
installed in this environment.

## Project facts

- **Stack**: Express + PostgreSQL (Supabase) in `server/`, React + Vite in `web/`,
  Expo React Native staff app in `mobile/`. Single deployable: the server serves
  the built web app.
- **Database**: Supabase project "RS Group Medical Shop" (`rpwndipzblvrbcdqzwdb`,
  ap-south-1), everything in schema `rsgroup` (RLS enabled, no policies — only the
  app server reads/writes). The user's OTHER Supabase project runs Laundry Spot —
  never touch it.
- **Hosting**: Railway (auto-deploys branch `claude/rs-group-medical-saas-k2eivu`),
  domain rs-group-production.up.railway.app, app listens on env PORT.
- **Env vars on Railway**: DATABASE_URL (Supabase session pooler), JWT_SECRET, PORT.

## Commands

- `npm run setup` — install server + web deps
- `npm run build` — build web app
- `node server/src/seed.js --force` — wipe & reseed sample data
- `node server/test/e2e.mjs` — 56-test end-to-end suite (needs running server;
  ALWAYS run against a freshly seeded database or duplicate-data failures appear)
- CI: `.github/workflows/ci.yml` builds + seeds + runs the e2e suite on every push

## Hard-won gotchas (do not regress)

- Never write `useEffect(load, deps)` where `load` returns a promise — React
  calls the return value as cleanup and crashes. Use `useEffect(() => { load(); }, deps)`.
- Missing `/assets/*` files must 404, never fall through to index.html.
- `db.js` type parsers return numerics as numbers and dates/timestamps as plain
  strings — keep it that way; the UI depends on it.
- Postgres `ROUND(x, 2)` needs `::numeric` cast on float expressions.
- Seed deletes must respect FK order; identity sequences reset via
  `TRUNCATE ... RESTART IDENTITY CASCADE`.
