import { Router } from 'express';
import { all, get, run, insert, tx } from '../db.js';
import { requirePermission, scopeBranch, writeBranch } from '../auth.js';
import { audit, notify, round2, supplierBalance, today } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Suppliers ----------------
router.get('/suppliers', requirePermission('purchases.view', 'suppliers.manage', 'inventory.view'), wrap(async (req, res) => {
  const rows = await all('SELECT * FROM suppliers WHERE active = 1 ORDER BY name');
  const out = [];
  for (const s of rows) out.push({ ...s, balance: await supplierBalance(s.id) });
  res.json({ suppliers: out });
}));

router.post('/suppliers', requirePermission('suppliers.manage'), wrap(async (req, res) => {
  const { name, contact_person = '', phone = '', email = '', address = '', gstin = '', drug_license = '', opening_balance = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Supplier name is required' });
  const id = await insert(`INSERT INTO suppliers (name, contact_person, phone, email, address, gstin, drug_license, opening_balance)
    VALUES (?,?,?,?,?,?,?,?)`, name.trim(), contact_person, phone, email, address, gstin, drug_license, opening_balance);
  audit(req, 'create', 'suppliers', id, name);
  res.json({ id });
}));

router.put('/suppliers/:id', requirePermission('suppliers.manage'), wrap(async (req, res) => {
  const f = req.body || {};
  await run(`UPDATE suppliers SET name=COALESCE(?,name), contact_person=COALESCE(?,contact_person),
    phone=COALESCE(?,phone), email=COALESCE(?,email), address=COALESCE(?,address), gstin=COALESCE(?,gstin),
    drug_license=COALESCE(?,drug_license), opening_balance=COALESCE(?,opening_balance), active=COALESCE(?,active) WHERE id=?`,
    f.name, f.contact_person, f.phone, f.email, f.address, f.gstin, f.drug_license, f.opening_balance, f.active, req.params.id);
  audit(req, 'update', 'suppliers', Number(req.params.id));
  res.json({ ok: true });
}));

// Supplier ledger: purchases (debit) vs payments/returns (credit)
router.get('/suppliers/:id/ledger', requirePermission('purchases.view', 'suppliers.manage', 'accounts.manage'), wrap(async (req, res) => {
  const supplier = await get('SELECT * FROM suppliers WHERE id = ?', req.params.id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  const purchases = await all(`SELECT id, invoice_no, invoice_date AS date, total AS debit, 0 AS credit, 'Purchase' AS type, branch_id
    FROM purchases WHERE supplier_id = ? AND status != 'returned'`, req.params.id);
  const payments = await all(`SELECT id, ref_no AS invoice_no, date, 0 AS debit, amount AS credit, 'Payment (' || method || ')' AS type, branch_id
    FROM supplier_payments WHERE supplier_id = ?`, req.params.id);
  const returns = await all(`SELECT id, '' AS invoice_no, created_at::date AS date, 0 AS debit, amount AS credit, 'Purchase Return' AS type, branch_id
    FROM purchase_returns WHERE supplier_id = ?`, req.params.id);
  const entries = [...purchases, ...payments, ...returns].sort((a, b) => a.date < b.date ? -1 : 1);
  let running = supplier.opening_balance || 0;
  const ledger = entries.map(e => { running = round2(running + e.debit - e.credit); return { ...e, balance: running }; });
  res.json({ supplier, opening_balance: supplier.opening_balance, ledger, balance: await supplierBalance(supplier.id) });
}));

router.post('/suppliers/:id/payments', requirePermission('accounts.manage', 'purchases.manage'), wrap(async (req, res) => {
  const { amount, method = 'bank', ref_no = '', date = today(), notes = '', purchase_id = null } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const branchId = writeBranch(req, req.body.branch_id);
  const id = await insert(`INSERT INTO supplier_payments (supplier_id, branch_id, purchase_id, amount, method, ref_no, date, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    req.params.id, branchId, purchase_id, amount, method, ref_no, date, notes, req.user.id);
  if (purchase_id) {
    await run('UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?', amount, purchase_id);
  }
  audit(req, 'supplier_payment', 'supplier_payments', id, `₹${amount}`);
  res.json({ id });
}));

// ---------------- Purchases ----------------
router.get('/', requirePermission('purchases.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const { from, to, supplier_id, status } = req.query;
  const where = ['1=1']; const params = [];
  if (branchId) { where.push('p.branch_id = ?'); params.push(branchId); }
  if (from) { where.push('p.invoice_date >= ?'); params.push(from); }
  if (to) { where.push('p.invoice_date <= ?'); params.push(to); }
  if (supplier_id) { where.push('p.supplier_id = ?'); params.push(supplier_id); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  const rows = await all(`SELECT p.*, s.name AS supplier_name, b.name AS branch_name, u.name AS created_by_name,
      (p.total - p.paid_amount) AS pending_amount
    FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN branches b ON b.id = p.branch_id
    LEFT JOIN users u ON u.id = p.created_by
    WHERE ${where.join(' AND ')} ORDER BY p.invoice_date DESC, p.id DESC LIMIT 300`, ...params);
  res.json({ purchases: rows });
}));

router.get('/:id(\\d+)', requirePermission('purchases.view'), wrap(async (req, res) => {
  const p = await get(`SELECT p.*, s.name AS supplier_name, b.name AS branch_name FROM purchases p
    JOIN suppliers s ON s.id = p.supplier_id JOIN branches b ON b.id = p.branch_id WHERE p.id = ?`, req.params.id);
  if (!p) return res.status(404).json({ error: 'Purchase not found' });
  p.items = await all(`SELECT pi.*, m.name AS medicine_name, m.unit FROM purchase_items pi
    JOIN medicines m ON m.id = pi.medicine_id WHERE pi.purchase_id = ?`, p.id);
  res.json({ purchase: p });
}));

// Purchase entry: creates batch-wise stock at the branch
router.post('/', requirePermission('purchases.manage'), wrap(async (req, res) => {
  const { supplier_id, invoice_no, invoice_date = today(), items = [], paid_amount = 0, invoice_file = null, notes = '' } = req.body || {};
  const branchId = writeBranch(req, req.body.branch_id);
  if (!supplier_id || !invoice_no) return res.status(400).json({ error: 'Supplier and invoice number are required' });
  if (!items.length) return res.status(400).json({ error: 'Add at least one item' });
  if (invoice_file && invoice_file.length > 2_000_000) return res.status(400).json({ error: 'Invoice file too large (max ~1.5MB)' });

  try {
    const { pid, total, paid } = await tx(async db => {
      let subtotal = 0, gstAmt = 0;
      const pid = await db.insert(`INSERT INTO purchases (branch_id, supplier_id, invoice_no, invoice_date, invoice_file, notes, created_by)
        VALUES (?,?,?,?,?,?,?)`, branchId, supplier_id, invoice_no, invoice_date, invoice_file, notes, req.user.id);
      for (const it of items) {
        const med = await db.get('SELECT * FROM medicines WHERE id = ?', it.medicine_id);
        if (!med) throw new Error('Medicine not found');
        const qty = Number(it.qty), freeQty = Number(it.free_qty || 0);
        if (!qty || qty <= 0 || !it.batch_no || !it.expiry_date) throw new Error(`Batch no, expiry and quantity required for ${med.name}`);
        const amount = round2(qty * Number(it.purchase_price));
        const gst = round2(amount * med.gst_rate / (100 + med.gst_rate));
        const existing = await db.get(`SELECT id FROM stock_batches WHERE medicine_id=? AND branch_id=? AND batch_no=? AND expiry_date=?`,
          it.medicine_id, branchId, it.batch_no, it.expiry_date);
        let batchId;
        if (existing) {
          await db.run(`UPDATE stock_batches SET qty = qty + ?, mrp = ?, purchase_price = ?, selling_price = ?, supplier_id = ? WHERE id = ?`,
            qty + freeQty, it.mrp, it.purchase_price, it.selling_price || it.mrp, supplier_id, existing.id);
          batchId = existing.id;
        } else {
          batchId = await db.insert(`INSERT INTO stock_batches (medicine_id, branch_id, supplier_id, batch_no, expiry_date, mrp, purchase_price, selling_price, qty)
            VALUES (?,?,?,?,?,?,?,?,?)`,
            it.medicine_id, branchId, supplier_id, it.batch_no, it.expiry_date, it.mrp, it.purchase_price, it.selling_price || it.mrp, qty + freeQty);
        }
        await db.run(`INSERT INTO purchase_items (purchase_id, medicine_id, batch_id, batch_no, expiry_date, qty, free_qty, purchase_price, mrp, selling_price, gst_rate, amount)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          pid, it.medicine_id, batchId, it.batch_no, it.expiry_date, qty, freeQty, it.purchase_price, it.mrp, it.selling_price || it.mrp, med.gst_rate, amount);
        subtotal += amount - gst; gstAmt += gst;
      }
      const total = round2(subtotal + gstAmt);
      const paid = Math.min(Number(paid_amount) || 0, total);
      await db.run('UPDATE purchases SET subtotal=?, gst_amount=?, total=?, paid_amount=? WHERE id=?',
        round2(subtotal), round2(gstAmt), total, paid, pid);
      if (paid > 0) {
        await db.run(`INSERT INTO supplier_payments (supplier_id, branch_id, purchase_id, amount, method, date, notes, created_by)
          VALUES (?,?,?,?,?,?,?,?)`, supplier_id, branchId, pid, paid, req.body.paid_method || 'bank', invoice_date, 'Paid with purchase entry', req.user.id);
      }
      return { pid, total, paid };
    });
    audit(req, 'create', 'purchases', pid, `${invoice_no} ₹${total}`);
    await notify({ branch_id: branchId, role: 'branch_admin', type: 'purchase', title: 'New purchase entry', message: `Invoice ${invoice_no} for ₹${total} recorded${paid < total ? ` (₹${round2(total - paid)} pending)` : ''}.` });
    res.json({ id: pid, total });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ---------------- Purchase returns ----------------
router.post('/:id(\\d+)/returns', requirePermission('purchases.manage'), wrap(async (req, res) => {
  const purchase = await get('SELECT * FROM purchases WHERE id = ?', req.params.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  const { items = [], reason = '' } = req.body || {};
  if (!items.length) return res.status(400).json({ error: 'Select items to return' });
  try {
    const { rid, total } = await tx(async db => {
      let total = 0;
      const rid = await db.insert(`INSERT INTO purchase_returns (purchase_id, branch_id, supplier_id, reason, created_by)
        VALUES (?,?,?,?,?)`, purchase.id, purchase.branch_id, purchase.supplier_id, reason, req.user.id);
      for (const it of items) {
        const pi = await db.get('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?', it.purchase_item_id, purchase.id);
        if (!pi) throw new Error('Purchase item not found');
        const qty = Number(it.qty);
        if (!qty || qty <= 0 || qty > pi.qty + pi.free_qty) throw new Error('Invalid return quantity');
        const batch = await db.get('SELECT * FROM stock_batches WHERE id = ?', pi.batch_id);
        if (batch.qty < qty) throw new Error(`Only ${batch.qty} left in batch ${batch.batch_no}; cannot return ${qty}`);
        await db.run('UPDATE stock_batches SET qty = qty - ? WHERE id = ?', qty, pi.batch_id);
        const amount = round2(qty * pi.purchase_price);
        await db.run(`INSERT INTO purchase_return_items (return_id, medicine_id, batch_id, qty, amount) VALUES (?,?,?,?,?)`,
          rid, pi.medicine_id, pi.batch_id, qty, amount);
        total += amount;
      }
      await db.run('UPDATE purchase_returns SET amount = ? WHERE id = ?', round2(total), rid);
      return { rid, total: round2(total) };
    });
    audit(req, 'purchase_return', 'purchase_returns', rid, `₹${total}`);
    res.json({ id: rid, amount: total });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

router.get('/returns/list', requirePermission('purchases.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const rows = await all(`SELECT r.*, s.name AS supplier_name, b.name AS branch_name, p.invoice_no
    FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id JOIN branches b ON b.id = r.branch_id
    LEFT JOIN purchases p ON p.id = r.purchase_id
    ${branchId ? 'WHERE r.branch_id = ?' : ''} ORDER BY r.id DESC LIMIT 100`,
    ...(branchId ? [branchId] : []));
  res.json({ returns: rows });
}));

// Pending supplier dues
router.get('/dues/summary', requirePermission('purchases.view', 'accounts.manage', 'dashboard.view'), wrap(async (req, res) => {
  const suppliers = await all('SELECT * FROM suppliers WHERE active = 1');
  const dues = [];
  for (const s of suppliers) {
    const balance = await supplierBalance(s.id);
    if (balance > 0) dues.push({ id: s.id, name: s.name, phone: s.phone, balance });
  }
  dues.sort((a, b) => b.balance - a.balance);
  res.json({ dues, total: round2(dues.reduce((a, s) => a + s.balance, 0)) });
}));

export default router;
