# RS Group Project Memory

- 2026-07-02: Built full system (Express+React+Expo), SQLite first, 56-test e2e suite.
- 2026-07-02: Migrated to Supabase Postgres, schema rsgroup, RLS deny-by-default.
- 2026-07-03: Created dedicated Supabase project 'RS Group Medical Shop' (ap-south-1); removed pharmacy schema from Laundry Spot project — zero overlap.
- 2026-07-03: Deployed to Railway (rs-group-production.up.railway.app, PORT=8080); auto-seed on first boot worked.
- 2026-07-03: Fixed blank-page (stale asset cache -> 404 + cache headers) and tab-switch crash (16x useEffect promise-cleanup bug). Added error boundary.
- 2026-07-03: Added GitHub Actions CI (build + Postgres + e2e); run #1 green.
- 2026-07-03: User requested always-on skills: caveman (exists), memory (created in-repo); graphify/headroom/ponytail not found anywhere.
