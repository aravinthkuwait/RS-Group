import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'rsgroup.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  drug_license TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','branch_admin','branch_manager','billing_staff','inventory_staff','accountant','delivery_staff','auditor')),
  branch_id INTEGER REFERENCES branches(id),
  extra_permissions TEXT DEFAULT '[]',
  denied_permissions TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1,
  reset_token TEXT,
  reset_token_expires TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  UNIQUE(role, permission)
);

CREATE TABLE IF NOT EXISTS login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  email TEXT,
  ip TEXT,
  user_agent TEXT,
  device TEXT,
  success INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  ip TEXT,
  user_agent TEXT,
  device TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  revoked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  generic_name TEXT DEFAULT '',
  category TEXT DEFAULT 'General',
  brand TEXT DEFAULT '',
  barcode TEXT,
  hsn TEXT DEFAULT '3004',
  gst_rate REAL DEFAULT 12,
  unit TEXT DEFAULT 'Strip',
  rack_location TEXT DEFAULT '',
  min_stock INTEGER DEFAULT 10,
  prescription_required INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_medicines_name ON medicines(name);
CREATE INDEX IF NOT EXISTS idx_medicines_barcode ON medicines(barcode);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  drug_license TEXT DEFAULT '',
  opening_balance REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  mrp REAL NOT NULL,
  purchase_price REAL NOT NULL,
  selling_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  damaged_qty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_batches_med_branch ON stock_batches(medicine_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON stock_batches(expiry_date);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  invoice_no TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  subtotal REAL DEFAULT 0,
  gst_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'received' CHECK (status IN ('pending','received','returned')),
  invoice_file TEXT,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  qty INTEGER NOT NULL,
  free_qty INTEGER DEFAULT 0,
  purchase_price REAL NOT NULL,
  mrp REAL NOT NULL,
  selling_price REAL NOT NULL,
  gst_rate REAL DEFAULT 12,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER REFERENCES purchases(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  reason TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  qty INTEGER NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  branch_id INTEGER REFERENCES branches(id),
  purchase_id INTEGER REFERENCES purchases(id),
  amount REAL NOT NULL,
  method TEXT DEFAULT 'cash',
  ref_no TEXT DEFAULT '',
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  dob TEXT,
  loyalty_points REAL DEFAULT 0,
  credit_limit REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  customer_id INTEGER REFERENCES customers(id),
  staff_id INTEGER REFERENCES users(id),
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  gst_amount REAL DEFAULT 0,
  round_off REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid_cash REAL DEFAULT 0,
  paid_upi REAL DEFAULT 0,
  paid_card REAL DEFAULT 0,
  credit_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed','held','cancelled','returned','partial_return')),
  doctor_name TEXT DEFAULT '',
  prescription_file TEXT,
  delivery_status TEXT,
  delivery_staff_id INTEGER REFERENCES users(id),
  delivery_address TEXT,
  delivered_at TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON sales(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  batch_no TEXT DEFAULT '',
  qty INTEGER NOT NULL,
  returned_qty INTEGER DEFAULT 0,
  mrp REAL NOT NULL,
  price REAL NOT NULL,
  purchase_price REAL DEFAULT 0,
  gst_rate REAL DEFAULT 12,
  gst_amount REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  customer_id INTEGER REFERENCES customers(id),
  staff_id INTEGER REFERENCES users(id),
  reason TEXT DEFAULT '',
  refund_amount REAL DEFAULT 0,
  refund_method TEXT DEFAULT 'cash',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER REFERENCES stock_batches(id),
  qty INTEGER NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  customer_id INTEGER REFERENCES customers(id),
  sale_id INTEGER REFERENCES sales(id),
  amount REAL NOT NULL,
  method TEXT DEFAULT 'cash',
  type TEXT DEFAULT 'receipt' CHECK (type IN ('receipt','refund')),
  ref_no TEXT DEFAULT '',
  date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  paid_method TEXT DEFAULT 'cash',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  date TEXT NOT NULL,
  opening_balance REAL DEFAULT 0,
  cash_sales REAL DEFAULT 0,
  cash_expenses REAL DEFAULT 0,
  cash_deposited REAL DEFAULT 0,
  expected_cash REAL DEFAULT 0,
  actual_cash REAL DEFAULT 0,
  difference REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  closed_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(branch_id, date)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_branch_id INTEGER NOT NULL REFERENCES branches(id),
  to_branch_id INTEGER NOT NULL REFERENCES branches(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  completed_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER NOT NULL REFERENCES stock_batches(id),
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER NOT NULL REFERENCES stock_batches(id),
  qty_change INTEGER NOT NULL,
  type TEXT DEFAULT 'adjustment' CHECK (type IN ('adjustment','damage','expiry_writeoff')),
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  method TEXT DEFAULT 'mobile',
  notes TEXT DEFAULT '',
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  assigned_to INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
  due_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  user_id INTEGER REFERENCES users(id),
  role TEXT,
  type TEXT DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT DEFAULT '',
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  action TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id INTEGER,
  details TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export default db;
