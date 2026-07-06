import { Router } from 'express';
import { all, get, run, insert } from '../db.js';
import { requirePermission, scopeBranch, writeBranch } from '../auth.js';
import { audit, auditDiff, round2, today, customerCreditBalance, customerCreditBalances } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', requirePermission('customers.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const { q = '', page = 1, limit = 50 } = req.query;
  const where = ['c.active = 1']; const params = [];
  if (branchId) { where.push('c.branch_id = ?'); params.push(branchId); }
  if (q) { where.push('(c.name ILIKE ? OR c.phone ILIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const total = (await get(`SELECT COUNT(*) AS c FROM customers c WHERE ${where.join(' AND ')}`, ...params)).c;
  const rows = await all(`SELECT c.*, b.name AS branch_name,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status NOT IN ('cancelled','held')) AS total_bills,
      (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id = c.id AND s.status NOT IN ('cancelled','held')) AS total_spent,
      (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id) AS last_purchase
    FROM customers c LEFT JOIN branches b ON b.id = c.branch_id
    WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT ? OFFSET ?`,
    ...params, Number(limit), (Number(page) - 1) * Number(limit));
  const balances = await customerCreditBalances(rows.map(c => c.id));
  const customers = rows.map(c => ({ ...c, credit_balance: balances[c.id] || 0 }));
  res.json({ customers, total });
}));

router.get('/:id(\\d+)', requirePermission('customers.view'), wrap(async (req, res) => {
  const c = await get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const sales = await all(`SELECT s.id, s.invoice_no, s.total, s.credit_amount, s.status, s.created_at, b.name AS branch_name
    FROM sales s JOIN branches b ON b.id = s.branch_id
    WHERE s.customer_id = ? AND s.status != 'held' ORDER BY s.created_at DESC LIMIT 100`, c.id);
  const payments = await all('SELECT * FROM payments WHERE customer_id = ? ORDER BY date DESC LIMIT 100', c.id);
  // Repeat purchase analytics: most bought medicines
  const topItems = await all(`SELECT m.name, SUM(si.qty)::int AS qty, COUNT(DISTINCT si.sale_id) AS times
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN medicines m ON m.id = si.medicine_id
    WHERE s.customer_id = ? AND s.status NOT IN ('cancelled','held')
    GROUP BY m.name ORDER BY qty DESC LIMIT 10`, c.id);
  const monthly = await all(`SELECT to_char(created_at, 'YYYY-MM') AS month, COUNT(*) AS bills, SUM(total) AS amount
    FROM sales WHERE customer_id = ? AND status NOT IN ('cancelled','held')
    GROUP BY month ORDER BY month DESC LIMIT 12`, c.id);
  res.json({
    customer: { ...c, credit_balance: await customerCreditBalance(c.id) },
    sales, payments, top_items: topItems, monthly,
  });
}));

router.post('/', requirePermission('customers.manage'), wrap(async (req, res) => {
  const { name, phone, email = '', address = '', dob = null, credit_limit = 0, notes = '',
    gstin = '', customer_type = 'individual', discount_percent = 0 } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Name and mobile number are required' });
  const pct = Number(discount_percent) || 0;
  if (pct < 0 || pct > 100) return res.status(400).json({ error: 'Customer discount % must be 0-100' });
  const dup = await get('SELECT id FROM customers WHERE phone = ?', phone.trim());
  if (dup) return res.status(400).json({ error: 'A customer with this mobile number already exists' });
  const branchId = writeBranch(req, req.body.branch_id);
  const id = await insert(`INSERT INTO customers (branch_id, name, phone, email, address, dob, credit_limit, notes, gstin, customer_type, discount_percent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, branchId, name.trim(), phone.trim(), email, address, dob || null, credit_limit, notes,
    gstin, customer_type === 'business' ? 'business' : 'individual', pct);
  audit(req, 'create', 'customers', id, name);
  res.json({ id });
}));

router.put('/:id(\\d+)', requirePermission('customers.manage'), wrap(async (req, res) => {
  const f = req.body || {};
  const before = await get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!before) return res.status(404).json({ error: 'Customer not found' });
  if (f.discount_percent !== undefined && f.discount_percent !== null) {
    const pct = Number(f.discount_percent) || 0;
    if (pct < 0 || pct > 100) return res.status(400).json({ error: 'Customer discount % must be 0-100' });
  }
  await run(`UPDATE customers SET name=COALESCE(?,name), phone=COALESCE(?,phone), email=COALESCE(?,email),
    address=COALESCE(?,address), dob=?, credit_limit=COALESCE(?,credit_limit),
    loyalty_points=COALESCE(?,loyalty_points), notes=COALESCE(?,notes), active=COALESCE(?,active),
    gstin=COALESCE(?,gstin), customer_type=COALESCE(?,customer_type),
    discount_percent=COALESCE(?,discount_percent) WHERE id=?`,
    f.name, f.phone, f.email, f.address, 'dob' in f ? (f.dob || null) : before.dob, f.credit_limit, f.loyalty_points, f.notes, f.active,
    f.gstin, f.customer_type, f.discount_percent, req.params.id);
  auditDiff(req, 'customers', Number(req.params.id), before, f,
    ['name', 'phone', 'email', 'address', 'credit_limit', 'notes', 'active', 'gstin', 'customer_type', 'discount_percent']);
  res.json({ ok: true });
}));

// Receive payment against customer credit
router.post('/:id(\\d+)/payments', requirePermission('billing.create', 'accounts.manage'), wrap(async (req, res) => {
  const { amount, method = 'cash', ref_no = '', notes = '' } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const c = await get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const branchId = writeBranch(req, req.body.branch_id);
  const id = await insert(`INSERT INTO payments (branch_id, customer_id, amount, method, type, ref_no, date, notes, created_by)
    VALUES (?,?,?,?,'receipt',?,?,?,?)`,
    branchId, c.id, amount, method, ref_no, today(), notes, req.user.id);
  audit(req, 'customer_payment', 'payments', id, `${c.name} ₹${amount}`);
  res.json({ id, credit_balance: await customerCreditBalance(c.id) });
}));

// Credit dues list + reminder message (SMS/WhatsApp)
router.get('/dues/list', requirePermission('customers.view', 'accounts.manage', 'dashboard.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const rows = await all(`SELECT c.* FROM customers c WHERE c.active = 1 ${branchId ? 'AND c.branch_id = ?' : ''}`,
    ...(branchId ? [branchId] : []));
  const dues = [];
  for (const c of rows) {
    const balance = await customerCreditBalance(c.id);
    if (balance > 0) dues.push({ id: c.id, name: c.name, phone: c.phone, credit_balance: balance });
  }
  dues.sort((a, b) => b.credit_balance - a.credit_balance);
  res.json({ dues, total: round2(dues.reduce((a, c) => a + c.credit_balance, 0)) });
}));

router.get('/:id(\\d+)/reminder', requirePermission('customers.view'), wrap(async (req, res) => {
  const c = await get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const balance = await customerCreditBalance(c.id);
  const msg = `Dear ${c.name}, this is a gentle reminder from RS Group Medicals. Your pending credit balance is ₹${balance.toFixed(2)}. Kindly clear it at your convenience. Thank you!`;
  const phone = c.phone.replace(/[^0-9]/g, '');
  res.json({ message: msg, whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, sms_url: `sms:${c.phone}?body=${encodeURIComponent(msg)}` });
}));

export default router;
