import { all, get, run, insert } from './db.js';

// ---------- Audit log ----------
export function audit(req, action, entity = '', entityId = null, details = '') {
  run(`INSERT INTO audit_logs (user_id, branch_id, action, entity, entity_id, details, ip)
       VALUES (?,?,?,?,?,?,?)`,
    req.user?.id || null, req.user?.branch_id || null, action, entity, entityId,
    typeof details === 'string' ? details : JSON.stringify(details), req.ip || '')
    .catch(e => console.error('audit failed:', e.message));
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

export async function notify({ branch_id = null, user_id = null, role = null, type = 'info', title, message = '' }) {
  const id = await insert(`INSERT INTO notifications (branch_id, user_id, role, type, title, message)
                           VALUES (?,?,?,?,?,?)`, branch_id, user_id, role, type, title, message);
  const n = { id, branch_id, user_id, role, type, title, message };
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
export async function nextInvoiceNo(branchId, dbh = { get }) {
  const branch = await dbh.get('SELECT code FROM branches WHERE id = ?', branchId);
  const year = new Date().getFullYear();
  const row = await dbh.get('SELECT COUNT(*) AS c FROM sales WHERE branch_id = ?', branchId);
  let seq = row.c + 1;
  let invoiceNo;
  do {
    invoiceNo = `${branch.code}/${year}/${String(seq).padStart(5, '0')}`;
    seq += 1;
  } while (await dbh.get('SELECT 1 FROM sales WHERE invoice_no = ?', invoiceNo));
  return invoiceNo;
}

// ---------- Stock helpers ----------
export async function branchStock(medicineId, branchId) {
  const row = await get(`SELECT COALESCE(SUM(qty),0) AS qty FROM stock_batches
                         WHERE medicine_id = ? AND branch_id = ?`, medicineId, branchId);
  return row.qty;
}

export async function checkStockAlerts(medicineId, branchId) {
  const med = await get('SELECT * FROM medicines WHERE id = ?', medicineId);
  if (!med) return;
  const qty = await branchStock(medicineId, branchId);
  if (qty <= 0) {
    await notify({ branch_id: branchId, type: 'stock', title: 'Out of stock', message: `${med.name} is out of stock.` });
  } else if (qty <= med.min_stock) {
    await notify({ branch_id: branchId, type: 'stock', title: 'Low stock alert', message: `${med.name} has only ${qty} ${med.unit}(s) left (min ${med.min_stock}).` });
  }
}

// ---------- Settings ----------
export async function getSetting(key, fallback = null) {
  const row = await get('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export async function setSetting(key, value) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value));
}

// ---------- Misc ----------
export const today = () => new Date().toISOString().slice(0, 10);
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function customerCreditBalance(customerId) {
  const credit = (await get(`SELECT COALESCE(SUM(credit_amount),0) AS c FROM sales
                             WHERE customer_id = ? AND status != 'cancelled'`, customerId)).c;
  const paid = (await get(`SELECT COALESCE(SUM(CASE WHEN type='receipt' THEN amount ELSE -amount END),0) AS p
                           FROM payments WHERE customer_id = ? AND sale_id IS NULL`, customerId)).p;
  return round2(credit - paid);
}

export async function supplierBalance(supplierId) {
  const s = await get('SELECT opening_balance FROM suppliers WHERE id = ?', supplierId);
  const purchases = (await get(`SELECT COALESCE(SUM(total),0) AS t FROM purchases
                                WHERE supplier_id = ? AND status != 'returned'`, supplierId)).t;
  const returns = (await get('SELECT COALESCE(SUM(amount),0) AS t FROM purchase_returns WHERE supplier_id = ?', supplierId)).t;
  const paid = (await get('SELECT COALESCE(SUM(amount),0) AS t FROM supplier_payments WHERE supplier_id = ?', supplierId)).t;
  return round2((s?.opening_balance || 0) + purchases - returns - paid);
}
