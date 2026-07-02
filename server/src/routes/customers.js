import { Router } from 'express';
import db from '../db.js';
import { requirePermission, scopeBranch, writeBranch } from '../auth.js';
import { audit, round2, today, customerCreditBalance } from '../util.js';

const router = Router();

router.get('/', requirePermission('customers.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const { q = '', page = 1, limit = 50 } = req.query;
  const where = ['c.active = 1']; const params = [];
  if (branchId) { where.push('c.branch_id = ?'); params.push(branchId); }
  if (q) { where.push('(c.name LIKE ? OR c.phone LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const total = db.prepare(`SELECT COUNT(*) c FROM customers c WHERE ${where.join(' AND ')}`).get(...params).c;
  const rows = db.prepare(`SELECT c.*, b.name AS branch_name,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status NOT IN ('cancelled','held')) AS total_bills,
      (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id = c.id AND s.status NOT IN ('cancelled','held')) AS total_spent,
      (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id) AS last_purchase
    FROM customers c LEFT JOIN branches b ON b.id = c.branch_id
    WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), (Number(page) - 1) * Number(limit));
  res.json({ customers: rows.map(c => ({ ...c, credit_balance: customerCreditBalance(c.id) })), total });
});

router.get('/:id(\\d+)', requirePermission('customers.view'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const sales = db.prepare(`SELECT s.id, s.invoice_no, s.total, s.credit_amount, s.status, s.created_at, b.name AS branch_name
    FROM sales s JOIN branches b ON b.id = s.branch_id
    WHERE s.customer_id = ? AND s.status != 'held' ORDER BY s.created_at DESC LIMIT 100`).all(c.id);
  const payments = db.prepare(`SELECT * FROM payments WHERE customer_id = ? ORDER BY date DESC LIMIT 100`).all(c.id);
  // Repeat purchase analytics: most bought medicines
  const topItems = db.prepare(`SELECT m.name, SUM(si.qty) AS qty, COUNT(DISTINCT si.sale_id) AS times
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN medicines m ON m.id = si.medicine_id
    WHERE s.customer_id = ? AND s.status NOT IN ('cancelled','held')
    GROUP BY si.medicine_id ORDER BY qty DESC LIMIT 10`).all(c.id);
  const monthly = db.prepare(`SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS bills, SUM(total) AS amount
    FROM sales WHERE customer_id = ? AND status NOT IN ('cancelled','held')
    GROUP BY month ORDER BY month DESC LIMIT 12`).all(c.id);
  res.json({
    customer: { ...c, credit_balance: customerCreditBalance(c.id) },
    sales, payments, top_items: topItems, monthly,
  });
});

router.post('/', requirePermission('customers.manage'), (req, res) => {
  const { name, phone, email = '', address = '', dob = null, credit_limit = 0, notes = '' } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Name and mobile number are required' });
  const dup = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone.trim());
  if (dup) return res.status(400).json({ error: 'A customer with this mobile number already exists' });
  const branchId = writeBranch(req, req.body.branch_id);
  const info = db.prepare(`INSERT INTO customers (branch_id, name, phone, email, address, dob, credit_limit, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(branchId, name.trim(), phone.trim(), email, address, dob, credit_limit, notes);
  audit(req, 'create', 'customers', info.lastInsertRowid, name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id(\\d+)', requirePermission('customers.manage'), (req, res) => {
  const f = req.body || {};
  db.prepare(`UPDATE customers SET name=COALESCE(?,name), phone=COALESCE(?,phone), email=COALESCE(?,email),
    address=COALESCE(?,address), dob=COALESCE(?,dob), credit_limit=COALESCE(?,credit_limit),
    loyalty_points=COALESCE(?,loyalty_points), notes=COALESCE(?,notes), active=COALESCE(?,active) WHERE id=?`)
    .run(f.name, f.phone, f.email, f.address, f.dob, f.credit_limit, f.loyalty_points, f.notes, f.active, req.params.id);
  audit(req, 'update', 'customers', Number(req.params.id));
  res.json({ ok: true });
});

// Receive payment against customer credit
router.post('/:id(\\d+)/payments', requirePermission('billing.create', 'accounts.manage'), (req, res) => {
  const { amount, method = 'cash', ref_no = '', notes = '' } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const branchId = writeBranch(req, req.body.branch_id);
  const info = db.prepare(`INSERT INTO payments (branch_id, customer_id, amount, method, type, ref_no, date, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(branchId, c.id, amount, method, 'receipt', ref_no, today(), notes, req.user.id);
  audit(req, 'customer_payment', 'payments', info.lastInsertRowid, `${c.name} ₹${amount}`);
  res.json({ id: info.lastInsertRowid, credit_balance: customerCreditBalance(c.id) });
});

// Credit dues list + reminder message (SMS/WhatsApp)
router.get('/dues/list', requirePermission('customers.view', 'accounts.manage', 'dashboard.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const rows = db.prepare(`SELECT c.* FROM customers c WHERE c.active = 1 ${branchId ? 'AND c.branch_id = ?' : ''}`)
    .all(...(branchId ? [branchId] : []));
  const dues = rows.map(c => ({ id: c.id, name: c.name, phone: c.phone, credit_balance: customerCreditBalance(c.id) }))
    .filter(c => c.credit_balance > 0).sort((a, b) => b.credit_balance - a.credit_balance);
  res.json({ dues, total: round2(dues.reduce((a, c) => a + c.credit_balance, 0)) });
});

router.get('/:id(\\d+)/reminder', requirePermission('customers.view'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const balance = customerCreditBalance(c.id);
  const msg = `Dear ${c.name}, this is a gentle reminder from RS Group Medicals. Your pending credit balance is ₹${balance.toFixed(2)}. Kindly clear it at your convenience. Thank you!`;
  const phone = c.phone.replace(/[^0-9]/g, '');
  res.json({ message: msg, whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, sms_url: `sms:${c.phone}?body=${encodeURIComponent(msg)}` });
});

export default router;
