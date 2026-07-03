# RS Group Project Memory

- 2026-07-02: Built full system (Express+React+Expo), SQLite first, 56-test e2e suite.
- 2026-07-02: Migrated to Supabase Postgres, schema rsgroup, RLS deny-by-default.
- 2026-07-03: Created dedicated Supabase project 'RS Group Medical Shop' (ap-south-1); removed pharmacy schema from Laundry Spot project — zero overlap.
- 2026-07-03: Deployed to Railway (rs-group-production.up.railway.app, PORT=8080); auto-seed on first boot worked.
- 2026-07-03: Fixed blank-page (stale asset cache -> 404 + cache headers) and tab-switch crash (16x useEffect promise-cleanup bug). Added error boundary.
- 2026-07-03: Added GitHub Actions CI (build + Postgres + e2e); run #1 green.
- 2026-07-03: User requested always-on skills: caveman (exists), memory (created in-repo); graphify/headroom/ponytail not found anywhere.
- 2026-07-03: Added PWA install (manifest+icons+sw) so staff install app from rs-group-production.up.railway.app; native APK needs Expo/EAS account, offered CI-built APK.
- 2026-07-03: Prepped mobile/ for EAS: SDK52, expo-camera, eas.json (preview=APK), BASE_URL=Railway. Waiting on user's EAS projectId to replace placeholder in app.json.
- 2026-07-03: EAS wired: project rs-group (owner aravinthkuwait, id 10c7a4a8-fd02-4bfb-9cba-aef7b84f579b), GitHub repo connected on expo.dev. User builds APK via Builds -> Build from GitHub, branch claude/rs-group-medical-saas-k2eivu, profile preview, base dir mobile.
- 2026-07-03: EAS build #1 failed at gradle (JPG icon/splash + RN 0.76.6 drift). Fixed: PNG assets 1024/splash 1284x2778, RN 0.76.9. User rebuilds from expo.dev.
- 2026-07-03: Live debounced search all lists; CSV Download buttons on ~20 tables; fixed owner expense missing branch. Field sweep 39/39, crash sweep clean, e2e 56/56.
- 2026-07-03: Added factory-reset endpoint+UI (keeps super admins/settings, seed guard via demo_data_wiped flag), JSON backend backup polished, PDFs: GST CGST/SGST breakdown, page X of Y, downloaded-by footer. All verified incl. 5-page report.
- 2026-07-03: v2 multibranch: users.extra_branches, pharmacist role, customer GST+type, branch manager, supplier payment terms, user delete (deactivate if history), audit old→new diffs, topbar logo, mobile Admin Users/Branches/Reports screens + branch switcher. Migration applied to Supabase.
- 2026-07-03: v3 discounts+stock popups: promotions table (branch/category/medicine offers with dates+min bill), customer discount_percent, users.max_discount_percent (billing staff default 5 via seed, fallback 10), manager-approval flow on over-limit MANUAL discounts (promo/customer types are pre-approved — exempt), item-wise sale_items.discount, discounts report (group=bill|branch|user|customer|product), invoice PDF gross/taxable/net/paid/balance + "You saved" line, stock_update notifications (data JSON payload) emitted on purchase/transfer-receive/positive adjustment with real-time web popup (dashboard/POS/inventory, selected-branch only) + /stock-updates history page + mobile support. e2e now 74 tests. Gotcha: seed categories are dosage forms (Tablet/Wellness/...), NOT 'Vitamins & Supplements'; e2e must reseed first; billing_staff role now includes billing.discount.
