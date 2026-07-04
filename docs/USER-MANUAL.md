# RS Group Medical Shop Management System — User Manual

**Web app:** https://rs-group-production.up.railway.app
**Mobile app:** RS Group Staff (Android APK built via Expo, or install the web app as PWA: open the site in Chrome → menu → *Add to Home screen*)

---

## 1. Getting started

### 1.1 Login
- Open the web address (or mobile app) and enter your **email + password**.
- Staff may also enter their **branch code** (e.g. `RSG-CHN`) — login is refused if they are not assigned to that branch.
- Forgot password? Use **Forgot password** on the login page — a 6-digit reset code is generated.

### 1.2 Default login for each role
One ready-to-use account exists for every role category:

| Role | Email | Password |
|---|---|---|
| Owner (super admin) | owner@rsgroup.in | rsgroup123 |
| Branch admin | admin@rsgroup.in | admin123 |
| Branch manager | manager@rsgroup.in | manager123 |
| Pharmacist | pharmacist@rsgroup.in | pharma123 |
| Billing staff | billing@rsgroup.in | billing123 |
| Inventory staff | inventory@rsgroup.in | inventory123 |
| Accountant | accounts@rsgroup.in | accounts123 |
| Delivery staff | delivery@rsgroup.in | delivery123 |
| Auditor | audit@rsgroup.in | audit123 |

> **Change these passwords before going live.** Sign in as each role (or edit them from **Staff & Tasks** as the owner) and set a new password. **Settings → Fresh Start** removes every account except the owner, so recreate any you still need afterwards.

### 1.3 Branches
- The **owner and auditor** can switch between branches (or view *All Branches*) using the dropdown in the top bar.
- Staff assigned to **multiple branches** (set on their user profile) can switch between their assigned branches the same way.
- Everyone else works in their own branch automatically.

---

## 2. Billing (POS)

Open **Billing (POS)**.

1. **Add items** — scan a barcode or type a few letters of the medicine name, generic name, category or batch number. Use ↑ ↓ + Enter on a keyboard, or tap a result. Expired batches are never offered.
2. **Customer** — type mobile number or name; matching customers appear instantly. New numbers create a light profile automatically with the bill.
3. **Prescription** — record the doctor's name and upload a photo of the prescription for Rx items.
4. **Discounts** — see section 3.
5. **Payment** — Cash / UPI / Card / Credit, or *Split payment* across methods. Credit sales need a customer mobile number.
6. **Save & Print Bill** — creates the invoice, reduces stock, awards loyalty points (1 point per ₹100). You can then download the **PDF invoice**, **print** it, or share it on **WhatsApp**.
7. **Hold** — parks the bill (stock is not reduced). Resume it later from *Held bills*.

**Returns & cancellations** — open the bill in **Sales & Bills** → *Return items* (stock goes back, refund by cash or credit note) or *Cancel bill*.

---

## 3. Discounts

Five ways to give a discount, from the **Discount** panel on the billing screen:

| Type | What it does |
|---|---|
| No Discount | Default. |
| Percentage (%) | % off the whole bill. |
| Fixed amount (₹) | Flat rupees off the bill. |
| Customer | The special % saved on the customer's profile (appears automatically when the customer is selected). |
| Offer 🏷️ | A promotional scheme valid today for this branch. |

- **Item-wise discount**: enter ₹ off per line in the *Disc ₹* column of the cart.
- The bill always shows **Gross → Discounts → Taxable → GST → Net Payable → Paid → Balance**, and the printed/PDF invoice adds *"You saved ₹X on this purchase!"*.

### 3.1 Discount limits & manager approval
- Every user has a **max discount %** (set in their user profile; default 10%, demo billing staff 5%).
- A *manual* discount above the limit pauses the bill and asks a **manager/admin to enter their email + password** to approve. The approver's name is stored on the bill and printed on the invoice.
- Promotional offers and customer special discounts are pre-approved by the admin who created them — no approval popup.

### 3.2 Promotional offers (admin / branch manager)
**Discounts & Offers** page → *New Offer*:
- % or ₹ value, valid **from–to dates**, optional **minimum bill amount**
- Scope: **all branches** or one branch; **whole bill**, a **category**, or a **specific medicine**
- Offers appear automatically in every billing screen while valid. Deleting an offer that was used on bills deactivates it instead (history stays correct).

### 3.3 Discount reports
**Reports → Discounts** — switch grouping: **Bill / Branch / User / Customer / Product-wise**. Shows total discount given in the period and profit impact. Download as PDF or Excel.

---

## 4. Inventory

- **Inventory** — every medicine with batch-level stock, MRP, selling price, rack location. Live search. Add/edit medicines (name, generic, category, HSN, GST %, unit, min stock, Rx flag, barcode).
- **Stock Alerts** — expired, expiring in 30/60/90 days, low stock, out of stock, fast/slow movers, and suggested clearance discounts for near-expiry stock.
- **Stock adjustments** — correct quantities with a reason (audit-logged). Damage reduces sellable stock.
- **Stock Transfers** — send batches to another branch. The receiving branch confirms with *Receive*; until then goods are "in transit". Cancel returns stock to the sender.

### 4.1 Stock update popups 📦
Whenever stock **arrives** in your branch (purchase entry, transfer received, or a positive adjustment), everyone in that branch gets an instant popup on the Dashboard, Billing and Inventory screens showing item, batch, expiry, quantity added, new total and who updated it — with **View Stock / Mark as Read / Close** buttons. The **Stock Updates** page keeps the full history with read/unread status and CSV download.

---

## 5. Purchases & suppliers

- **Suppliers** — contact details, GSTIN, payment terms, opening balance. The ledger shows every purchase, return and payment with a running balance.
- **New purchase** — pick supplier, enter invoice no./date, then add each item with:
  - **Medicine** — search an existing one, or type a new name to create it inline
  - **Brand name** & **Generic name** — searchable master lists; pick an existing value or add a new one (one generic can have many brands)
  - **Strip count** — tablets/capsules per strip (used in inventory & billing)
  - **Batch number** (mandatory) and **Expiry (MM/YYYY)** (mandatory)
  - Quantity (+ free qty), purchase price, MRP, selling price
  Saving **adds the stock immediately** batch-wise and records how much was paid; the rest sits as supplier due.
- **Edit / delete** — you can edit a purchase's invoice details, or delete a purchase to reverse the stock it added (refused once any of that stock has been sold — use a return instead).
- **Purchase returns** — return items to the supplier (stock is reduced, due is adjusted).
- **Supplier payments** — record payments any time; dues appear on the dashboard.

---

## 6. Customers

- Profile: name, mobile, email, address, DOB, **Individual/Business** type, **GSTIN** (printed on their invoices), **credit limit**, and **special discount %**.
- Automatic **loyalty points** (1 per ₹100) and purchase history with most-bought medicines.
- **Credit ledger** — credit sales accumulate as dues; use *Receive payment* to settle. Credit dues appear on the dashboard.

---

## 7. Accounts

- **Expenses** — record by category (rent, salary, electricity…) per branch.
- **Daily cash closing** — count the drawer and close the day; differences are recorded.
- **Reports → Profit & Loss** — revenue, cost of goods, refunds, discounts, expenses, net profit.

---

## 8. Reports

**Reports** page (owner/manager/accountant/auditor): Sales, Product-wise, Staff sales, **Discounts**, Stock (batch-wise), **Brand-wise stock**, **Generic-wise stock**, **Low stock**, Expiry, Purchases, GST/Tax, Profit & Loss.
- Filter by date range and branch. Every report downloads as **PDF or Excel**.
- Every PDF carries the company logo & address, branch, period, page numbers, and **who downloaded it and when**.

---

## 9. Staff, tasks & attendance

- **Users** — create staff with role, primary branch, extra branches (multi-branch access), max discount %, and per-user permission overrides. Deactivate or delete (users with billing history are deactivated, never erased).
- **Roles**: super admin, branch admin, branch manager, pharmacist, billing staff, inventory staff, accountant, delivery staff, auditor. The owner can edit the **role → permission matrix** in Settings.
- **Tasks** — assign work with due dates; staff mark them done.
- **Attendance** — staff check in/out on web or mobile; managers see the log.
- **Deliveries** — bills marked for delivery are picked up and completed by delivery staff (works on mobile).
- **Notifications** 🔔 — low stock, expiry, transfers, purchases, broadcasts, and stock updates, in real time.

---

## 10. Settings (owner)

- **Company profile** — name, address, GSTIN, drug licence (printed on invoices).
- **Branches** — create/edit branches with **manager name**; branches with history are deactivated, not deleted.
- **Role permissions** — tick/untick what each role can do.
- **Audit log** — every important action with **old value → new value** detail.
- **Backup** — one-click JSON download of the whole database (passwords excluded).
- **Fresh Start** — wipe all demo/auto-created data (asks for your password + typing DELETE). Keeps owner accounts and settings.

---

## 11. Mobile app (RS Group Staff)

Same login as the web app. Company logo appears on every page header.

| Screen | What you can do |
|---|---|
| Home | Today/month sales, low stock, expiry risk, best sellers, quick links |
| Billing | Search or **scan barcodes with the camera**, live customer search by mobile/name, discounts incl. offers + manager approval, save bill |
| Stock | Live stock search (name/batch/brand/generic); long-press to adjust |
| Purchases | List purchases; **New Purchase Entry** with supplier/brand/generic pickers, MM/YYYY expiry, strip count, barcode scan, and auto-saved draft |
| Expiry | Expired + expiring batches |
| Customers | Search, view credit/loyalty, **add customers** (with GST + special discount) |
| Reports | All 9 reports with branch filter |
| Users & Staff / Branches | Full admin (owner/managers) |
| Deliveries, Tasks, Attendance, Notifications | Same as web |

Multi-branch users get a **branch chip bar** on Home/Billing/Stock/Reports. Billing always works in one concrete branch.

**Updating the app:** after code changes, rebuild the APK on expo.dev (Builds → Build from GitHub → branch `claude/rs-group-medical-saas-k2eivu`, profile **preview**, base directory **mobile**) and install the new APK.

---

## 12. Administration & deployment (reference)

- **Source code:** GitHub `aravinthkuwait/RS-Group`. Working branch `claude/rs-group-medical-saas-k2eivu` (auto-deployed), stable mirror `main` via pull requests.
- **Hosting:** Railway — auto-deploys every push; the server serves both the API and the web app (port from `PORT`, health check `/api/health`).
- **Database:** Supabase project *RS Group Medical Shop* (`rpwndipzblvrbcdqzwdb`, schema `rsgroup`). Fully separate from your Laundry Spot project.
- **Environment variables (Railway):** `DATABASE_URL` (Supabase session pooler), `JWT_SECRET`, `PORT`.
- **CI:** every push runs the automated 74-test suite on GitHub Actions.
- If the server boots with an empty database it seeds the demo data automatically (skipped after Fresh Start).

---

*RS Group · Empowering Health, Enriching Education, Excelling in Sports*
