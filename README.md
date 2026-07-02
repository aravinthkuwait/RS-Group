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
| `server/` | Node.js (Express) REST API + SQLite database + PDF/Excel generation. Also serves the built web app — one deployable unit. |
| `web/` | React (Vite) web app — Owner dashboard, Admin panel, Branch manager portal, Billing POS. Fully mobile-responsive. |
| `mobile/` | Native staff app (Expo / React Native) — billing, barcode scan, stock, expiry, deliveries, tasks, attendance, notifications. |
| `assets/` | RS Group brand logo (embedded in the UI and on PDF invoices/reports). |

## Quick start

```bash
npm run setup        # installs server + web dependencies
npm start            # builds the web app and starts the server on :4000
```

Open **http://localhost:4000** — the database auto-seeds with sample data on first run:
**3 branches, 11 users, 50 medicines, 10 suppliers, 150 stock batches, 100 sales bills**, customers, expenses, purchases, tasks and attendance.

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
┌───────────────┐     ┌──────────────────────────────┐
│  Web app       │     │  server/ (Express, :4000)    │
│  React + Vite  │────▶│  /api/auth  /api/sales       │     ┌──────────────┐
│  (built into   │     │  /api/inventory /api/reports │────▶│ SQLite (WAL) │
│  server/dist)  │     │  /api/purchases /api/staff…  │     │ server/data/ │
├───────────────┤     │  JWT auth · RBAC · audit     │     └──────────────┘
│  Staff app     │────▶│  SSE realtime · PDFKit · XLSX│
│  Expo (mobile/)│     └──────────────────────────────┘
└───────────────┘
```

- **API-first**: every screen works through the same documented REST API under `/api/*`.
- **SQLite in WAL mode** keeps the system zero-dependency and fast; swap `server/src/db.js`
  for Postgres/MySQL when scaling beyond a single node.
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

## Deployment

The server is a single Node process serving both API and web app:

```bash
npm run setup && npm run build
PORT=4000 JWT_SECRET="change-me-to-a-long-random-string" node server/src/index.js
```

- Put it behind any reverse proxy (nginx/Caddy) with HTTPS.
- Set `JWT_SECRET` (required for production) and optionally `DATA_DIR` for the DB location.
- Backups: Settings → Company → *Download database backup* (or copy `server/data/rsgroup.db`).
- For the staff app, set `BASE_URL` in `mobile/src/api.js` to your deployed HTTPS URL and
  build with `eas build` (Expo).

## Sample data

Seeded automatically on first run (or `node server/src/seed.js --force`):
3 branches (Chennai, Madurai, Coimbatore) · 11 users across all 8 roles ·
50 real-world medicines with GST rates and racks · 10 suppliers with ledgers ·
150 stock batches including expired/near-expiry ones (so the alert screens have data) ·
100 sales bills across 30 days with mixed payment modes · customers with credit and
loyalty points · expenses, tasks, attendance and a pending stock transfer.
