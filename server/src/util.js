import db from './db.js';

// ---------- Audit log ----------
export function audit(req, action, entity = '', entityId = null, details = '') {
  db.prepare(`INSERT INTO audit_logs (user_id, branch_id, action, entity, entity_id, details, ip)
              VALUES (?,?,?,?,?,?,?)`)
    .run(req.user?.id || null, req.user?.branch_id || null, action, entity, entityId,
      typeof details === 'string' ? details : JSON.stringify(details), req.ip || '');
}

// ---------- Notifications + real-time SSE bus ----------
const sseClients = new Set();

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 5000\n\n');
  const client = { res, user: req.user };
  sseClients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(client); });
}

function relevantTo(user, n) {
  if (n.user_id) return n.user_id === user.id;
  if (n.role && n.role !== user.role) return false;
  if (n.branch_id && !['super_admin', 'auditor'].includes(user.role) && user.branch_id !== n.branch_id) return false;
  return true;
}

export function notify({ branch_id = null, user_id = null, role = null, type = 'info', title, message = '' }) {
  const info = db.prepare(`INSERT INTO notifications (branch_id, user_id, role, type, title, message)
                           VALUES (?,?,?,?,?,?)`)
    .run(branch_id, user_id, role, type, title, message);
  const n = { id: info.lastInsertRowid, branch_id, user_id, role, type, title, message };
  for (const client of sseClients) {
    if (relevantTo(client.user, n)) {
      client.res.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`);
    }
  }
  return n;
}

export function broadcast(event, data, branch_id = null) {
  for (const client of sseClients) {
    if (branch_id && !['super_admin', 'auditor'].includes(client.user.role) && client.user.branch_id !== branch_id) continue;
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

// ---------- Invoice numbering ----------
export function nextInvoiceNo(branchId) {
  const branch = db.prepare('SELECT code FROM branches WHERE id = ?').get(branchId);
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM sales WHERE branch_id = ?`).get(branchId);
  let seq = row.c + 1;
  let invoiceNo;
  // Ensure uniqueness even after deletes/imports
  do {
    invoiceNo = `${branch.code}/${year}/${String(seq).padStart(5, '0')}`;
    seq += 1;
  } while (db.prepare('SELECT 1 FROM sales WHERE invoice_no = ?').get(invoiceNo));
  return invoiceNo;
}

// ---------- Stock helpers ----------
export function branchStock(medicineId, branchId) {
  const row = db.prepare(`SELECT COALESCE(SUM(qty),0) AS qty FROM stock_batches
                          WHERE medicine_id = ? AND branch_id = ?`).get(medicineId, branchId);
  return row.qty;
}

export function checkStockAlerts(medicineId, branchId) {
  const med = db.prepare('SELECT * FROM medicines WHERE id = ?').get(medicineId);
  if (!med) return;
  const qty = branchStock(medicineId, branchId);
  if (qty <= 0) {
    notify({ branch_id: branchId, type: 'stock', title: 'Out of stock', message: `${med.name} is out of stock.` });
  } else if (qty <= med.min_stock) {
    notify({ branch_id: branchId, type: 'stock', title: 'Low stock alert', message: `${med.name} has only ${qty} ${med.unit}(s) left (min ${med.min_stock}).` });
  }
}

// ---------- Settings ----------
export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// ---------- Misc ----------
export const today = () => new Date().toISOString().slice(0, 10);
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function customerCreditBalance(customerId) {
  const credit = db.prepare(`SELECT COALESCE(SUM(credit_amount),0) AS c FROM sales
                             WHERE customer_id = ? AND status != 'cancelled'`).get(customerId).c;
  const paid = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='receipt' THEN amount ELSE -amount END),0) AS p
                           FROM payments WHERE customer_id = ? AND sale_id IS NULL`).get(customerId).p;
  return round2(credit - paid);
}

export function supplierBalance(supplierId) {
  const s = db.prepare('SELECT opening_balance FROM suppliers WHERE id = ?').get(supplierId);
  const purchases = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM purchases
                                WHERE supplier_id = ? AND status != 'returned'`).get(supplierId).t;
  const returns = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM purchase_returns WHERE supplier_id = ?`).get(supplierId).t;
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM supplier_payments WHERE supplier_id = ?`).get(supplierId).t;
  return round2((s?.opening_balance || 0) + purchases - returns - paid);
}
