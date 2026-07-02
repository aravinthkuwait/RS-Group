<p align="center">
  <img src="assets/rs-group-logo.jpg" alt="RS Group" width="220" />
</p>

# RS Group — Medical Shop Management System

A complete, working, end-to-end SaaS system for the RS Group pharmacy chain:
multi-branch **billing (POS)**, **inventory**, **purchases**, **customers**,
**accounts**, **analytics**, **reports**, and a **native staff mobile app** —
all branded with the RS Group identity (white / blue / green / orange).

> Health Care · Education · Sports — *Empowering Health, Enriching Education, Excelling in Sports*

---

## What's inside

| Directory | What it is |
|---|---|
| `server/` | Node.js (Express) REST API backed by **Supabase (PostgreSQL)** + PDF/Excel generation. Also serves the built web app — one deployable unit for **Railway**. |
| `web/` | React (Vite) web app — Owner dashboard, Admin panel, Branch manager portal, Billing POS. Fully mobile-responsive. |
| `mobile/` | Native staff app (Expo / React Native) — billing, barcode scan, stock, expiry, deliveries, tasks, attendance, notifications. |
| `assets/` | RS Group brand logo (embedded in the UI and on PDF invoices/reports). |

**Hosting model:** Supabase hosts the database (schema `rsgroup`, locked down with RLS);
Railway hosts the app — the Express server serves both the frontend and the `/api/*` backend
and talks to Supabase over `DATABASE_URL`.

## Quick start (local development)

```bash
# Point at any Postgres — your Supabase connection string, or a local Postgres
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/rsgroup"

npm run setup        # installs server + web dependencies
npm start            # builds the web app and starts the server on :4000
```

Open **http://localhost:4000** — the schema is created automatically and the database
auto-seeds with sample data on first run:
**3 branches, 11 users, 50 medicines, 10 suppliers, 150 stock batches, 100 sales bills**,
customers, expenses, purchases, tasks and attendance. (Set `SEED_ON_EMPTY=0` to skip sample data.)

### Demo logins (password for all: `rsgroup123`)

| Role | Email | Branch |
|---|---|---|
| Super Admin / Owner | `owner@rsgroup.in` | All branches |
| Branch Admin | `priya@rsgroup.in` | Chennai (RSG-CHN) |
| Branch Manager | `karthik@rsgroup.in` | Madurai (RSG-MDU) |
| Billing Staff | `suresh@rsgroup.in` | Chennai |
| Inventory Staff | `vignesh@rsgroup.in` | Chennai |
| Accountant | `lakshmi@rsgroup.in` | Chennai |
| Delivery Staff | `ganesh@rsgroup.in` | Chennai |
| Read-only Auditor | `auditor@rsgroup.in` | All branches |

Branch portal login: enter the branch code (e.g. `RSG-CHN`) on the login screen —
users are verified against their assigned branch.

## Feature map

**Login & security** — role-based JWT auth (8 roles), branch-scoped access, editable
role-permission matrix + per-user overrides, forgot/reset password, change password,
login history, device/session tracking with remote sign-out, full audit log.

**Billing / POS** — fast search (name / generic / barcode / batch), keyboard-wedge
barcode scanner support, batch-wise FEFO suggestions, customer mobile capture with
auto profile, discounts (permission-gated), GST-inclusive tax math, cash/UPI/card/credit
+ split payments, hold & resume bills, cancel with stock restore, returns/refunds
(incl. credit notes), doctor name + prescription upload, PDF invoice with RS Group
branding, WhatsApp share link, print view.

**Inventory** — medicine master (category, brand, HSN, GST, rack, min-stock, Rx flag),
batch-level stock with expiry/MRP/cost/selling, damaged stock, stock adjustments with
reasons, inter-branch stock transfers (send → receive/cancel), expired / 30-60-90-day
expiry alerts, low/out-of-stock alerts, fast & slow movers, near-expiry discount suggestions.

**Purchases** — supplier master with ledger and balances, purchase entry with batch-wise
stock update + free qty, invoice file upload, purchase returns, supplier payments,
pending dues.

**Customers** — profiles, purchase history, repeat-purchase analytics, credit balances
& receipts, loyalty points, WhatsApp/SMS payment reminders.

**Accounts** — expenses by category, daily cash closing (opening balance → expected vs
counted cash with difference alerts), bank deposits, UPI reconciliation, supplier/customer
dues, profit & loss.

**Analytics dashboard** — today/month sales, estimated & net profit, 14-day trend,
6-month sales-vs-profit, branch-wise sales & stock value, payment split, best sellers,
staff performance, expiry-risk value, low stock count, dues.

**Reports (PDF + Excel export)** — sales, product-wise, staff-wise, stock, expiry,
purchases, GST/tax, profit & loss; all filterable by branch and date range.

**Notifications** — real-time (SSE) in-app notifications: low stock, expiry, cash-closing
reminders, purchase alerts, transfers, task assignments, admin announcements (by branch/role).

**Staff mobile app (Expo)** — login with branch check, dashboard, POS billing with camera
barcode scanning, stock search/update, expiry check, customer search, delivery status
updates, task list, attendance check-in/out, notifications.

## Architecture

```
┌───────────────┐     ┌───────────────────────────────┐     ┌────────────────────┐
│  Web app       │     │  RAILWAY                      │     │  SUPABASE          │
│  React + Vite  │────▶│  server/ (Express)            │     │  PostgreSQL        │
│  (served from  │     │  /api/auth  /api/sales        │────▶│  schema: rsgroup   │
│  the server)   │     │  /api/inventory /api/reports  │ SSL │  RLS: deny-by-     │
├───────────────┤     │  JWT auth · RBAC · audit      │     │  default (REST API │
│  Staff app     │────▶│  SSE realtime · PDFKit · XLSX │     │  blocked)          │
│  Expo (mobile/)│     └───────────────────────────────┘     └────────────────────┘
└───────────────┘
```

- **API-first**: every screen works through the same documented REST API under `/api/*`.
- **Supabase (PostgreSQL)** hosts all data in a dedicated `rsgroup` schema — it never
  touches other apps sharing the project. Every table has row-level security enabled
  with no policies, so Supabase's auto-generated REST API cannot read or write the data;
  only the app server (connecting as the database owner) can.
- **Branch scoping** is enforced server-side: non-owner users are locked to their branch
  on every read and write; owner/auditor can view all branches or filter one.

## Development

```bash
# API server with auto-reload (port 4000)
npm run dev:server

# Web app dev server with hot reload (port 5173, proxies /api to :4000)
npm run dev:web

# Reseed sample data from scratch
cd server && node src/seed.js --force

# Mobile app (needs Expo CLI; set BASE_URL in mobile/src/api.js to your server)
cd mobile && npm install && npm start
```

## Deployment — Supabase + Railway

### 1. Supabase (database) — already provisioned

The `rsgroup` schema with all 26 tables is applied to the Supabase project as migration
`rs_group_medical_shop_schema` (also in `server/src/schema.sql` / `supabase/migrations/`).
All tables have RLS enabled with no policies, so the data is not reachable through
Supabase's public REST API — only through the app server.

Get the connection string from **Supabase Dashboard → Connect → Session pooler**
(IPv4-friendly; use the database password you set when creating the project):

```
postgresql://postgres.<project-ref>:<DB-PASSWORD>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

### 2. Railway (app: frontend + API)

1. In Railway: **New Project → Deploy from GitHub repo** and pick this repository.
   `railway.json` already configures the build (`npm run setup && npm run build`),
   the start command, and the `/api/health` healthcheck.
2. Add environment variables on the service:
   - `DATABASE_URL` — the Supabase connection string above
   - `JWT_SECRET` — a long random string (e.g. `openssl rand -hex 32`)
   - optional: `SEED_ON_EMPTY=0` to start with an empty database instead of demo data
3. Deploy. On first boot the server creates/verifies the schema and, if the database is
   empty, seeds the full sample dataset automatically. Open the generated Railway URL
   and log in with the demo credentials.
4. **Generate Domain** in Railway settings for a public URL, then put that URL into
   `mobile/src/api.js` (`BASE_URL`) and build the staff app with `eas build` (Expo).

### Backups

Supabase manages database backups (Dashboard → Database → Backups). The app also offers
a portable JSON export of all business data under Settings → Company → Backup.

## Sample data

Seeded automatically on first run (or `node server/src/seed.js --force`):
3 branches (Chennai, Madurai, Coimbatore) · 11 users across all 8 roles ·
50 real-world medicines with GST rates and racks · 10 suppliers with ledgers ·
150 stock batches including expired/near-expiry ones (so the alert screens have data) ·
100 sales bills across 30 days with mixed payment modes · customers with credit and
loyalty points · expenses, tasks, attendance and a pending stock transfer.
