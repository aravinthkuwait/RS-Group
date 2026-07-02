import { Router } from 'express';
import db from '../db.js';
import { requirePermission, scopeBranch, writeBranch } from '../auth.js';
import { audit, notify, round2, supplierBalance, today } from '../util.js';

const router = Router();

// ---------------- Suppliers ----------------
router.get('/suppliers', requirePermission('purchases.view', 'suppliers.manage', 'inventory.view'), (req, res) => {
  const rows = db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name').all();
  res.json({ suppliers: rows.map(s => ({ ...s, balance: supplierBalance(s.id) })) });
});

router.post('/suppliers', requirePermission('suppliers.manage'), (req, res) => {
  const { name, contact_person = '', phone = '', email = '', address = '', gstin = '', drug_license = '', opening_balance = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Supplier name is required' });
  const info = db.prepare(`INSERT INTO suppliers (name, contact_person, phone, email, address, gstin, drug_license, opening_balance)
    VALUES (?,?,?,?,?,?,?,?)`).run(name.trim(), contact_person, phone, email, address, gstin, drug_license, opening_balance);
  audit(req, 'create', 'suppliers', info.lastInsertRowid, name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/suppliers/:id', requirePermission('suppliers.manage'), (req, res) => {
  const f = req.body || {};
  db.prepare(`UPDATE suppliers SET name=COALESCE(?,name), contact_person=COALESCE(?,contact_person),
    phone=COALESCE(?,phone), email=COALESCE(?,email), address=COALESCE(?,address), gstin=COALESCE(?,gstin),
    drug_license=COALESCE(?,drug_license), opening_balance=COALESCE(?,opening_balance), active=COALESCE(?,active) WHERE id=?`)
    .run(f.name, f.contact_person, f.phone, f.email, f.address, f.gstin, f.drug_license, f.opening_balance, f.active, req.params.id);
  audit(req, 'update', 'suppliers', Number(req.params.id));
  res.json({ ok: true });
});

// Supplier ledger: purchases (debit) vs payments/returns (credit)
router.get('/suppliers/:id/ledger', requirePermission('purchases.view', 'suppliers.manage', 'accounts.manage'), (req, res) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  const purchases = db.prepare(`SELECT id, invoice_no, invoice_date AS date, total AS debit, 0 AS credit, 'Purchase' AS type, branch_id
    FROM purchases WHERE supplier_id = ? AND status != 'returned'`).all(req.params.id);
  const payments = db.prepare(`SELECT id, ref_no AS invoice_no, date, 0 AS debit, amount AS credit, 'Payment (' || method || ')' AS type, branch_id
    FROM supplier_payments WHERE supplier_id = ?`).all(req.params.id);
  const returns = db.prepare(`SELECT id, '' AS invoice_no, date(created_at) AS date, 0 AS debit, amount AS credit, 'Purchase Return' AS type, branch_id
    FROM purchase_returns WHERE supplier_id = ?`).all(req.params.id);
  const entries = [...purchases, ...payments, ...returns].sort((a, b) => a.date < b.date ? -1 : 1);
  let running = supplier.opening_balance || 0;
  const ledger = entries.map(e => { running = round2(running + e.debit - e.credit); return { ...e, balance: running }; });
  res.json({ supplier, opening_balance: supplier.opening_balance, ledger, balance: supplierBalance(supplier.id) });
});

router.post('/suppliers/:id/payments', requirePermission('accounts.manage', 'purchases.manage'), (req, res) => {
  const { amount, method = 'bank', ref_no = '', date = today(), notes = '', purchase_id = null } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const branchId = writeBranch(req, req.body.branch_id);
  const info = db.prepare(`INSERT INTO supplier_payments (supplier_id, branch_id, purchase_id, amount, method, ref_no, date, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, branchId, purchase_id, amount, method, ref_no, date, notes, req.user.id);
  if (purchase_id) {
    db.prepare('UPDATE purchases SET paid_amount = paid_amount + ? WHERE id = ?').run(amount, purchase_id);
  }
  audit(req, 'supplier_payment', 'supplier_payments', info.lastInsertRowid, `₹${amount}`);
  res.json({ id: info.lastInsertRowid });
});

// ---------------- Purchases ----------------
router.get('/', requirePermission('purchases.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const { from, to, supplier_id, status } = req.query;
  const where = ['1=1']; const params = [];
  if (branchId) { where.push('p.branch_id = ?'); params.push(branchId); }
  if (from) { where.push('p.invoice_date >= ?'); params.push(from); }
  if (to) { where.push('p.invoice_date <= ?'); params.push(to); }
  if (supplier_id) { where.push('p.supplier_id = ?'); params.push(supplier_id); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  const rows = db.prepare(`SELECT p.*, s.name AS supplier_name, b.name AS branch_name, u.name AS created_by_name,
      (p.total - p.paid_amount) AS pending_amount
    FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN branches b ON b.id = p.branch_id
    LEFT JOIN users u ON u.id = p.created_by
    WHERE ${where.join(' AND ')} ORDER BY p.invoice_date DESC, p.id DESC LIMIT 300`).all(...params);
  res.json({ purchases: rows });
});

router.get('/:id(\\d+)', requirePermission('purchases.view'), (req, res) => {
  const p = db.prepare(`SELECT p.*, s.name AS supplier_name, b.name AS branch_name FROM purchases p
    JOIN suppliers s ON s.id = p.supplier_id JOIN branches b ON b.id = p.branch_id WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Purchase not found' });
  p.items = db.prepare(`SELECT pi.*, m.name AS medicine_name, m.unit FROM purchase_items pi
    JOIN medicines m ON m.id = pi.medicine_id WHERE pi.purchase_id = ?`).all(p.id);
  res.json({ purchase: p });
});

// Purchase entry: creates batch-wise stock at the branch
router.post('/', requirePermission('purchases.manage'), (req, res) => {
  const { supplier_id, invoice_no, invoice_date = today(), items = [], paid_amount = 0, invoice_file = null, notes = '' } = req.body || {};
  const branchId = writeBranch(req, req.body.branch_id);
  if (!supplier_id || !invoice_no) return res.status(400).json({ error: 'Supplier and invoice number are required' });
  if (!items.length) return res.status(400).json({ error: 'Add at least one item' });
  if (invoice_file && invoice_file.length > 2_000_000) return res.status(400).json({ error: 'Invoice file too large (max ~1.5MB)' });

  const tx = db.transaction(() => {
    let subtotal = 0, gstAmt = 0;
    const pid = db.prepare(`INSERT INTO purchases (branch_id, supplier_id, invoice_no, invoice_date, invoice_file, notes, created_by)
      VALUES (?,?,?,?,?,?,?)`).run(branchId, supplier_id, invoice_no, invoice_date, invoice_file, notes, req.user.id).lastInsertRowid;
    for (const it of items) {
      const med = db.prepare('SELECT * FROM medicines WHERE id = ?').get(it.medicine_id);
      if (!med) throw new Error('Medicine not found');
      const qty = Number(it.qty), freeQty = Number(it.free_qty || 0);
      if (!qty || qty <= 0 || !it.batch_no || !it.expiry_date) throw new Error(`Batch no, expiry and quantity required for ${med.name}`);
      const amount = round2(qty * Number(it.purchase_price));
      const gst = round2(amount * med.gst_rate / (100 + med.gst_rate));
      // Merge with existing identical batch if present
      const existing = db.prepare(`SELECT id FROM stock_batches WHERE medicine_id=? AND branch_id=? AND batch_no=? AND expiry_date=?`)
        .get(it.medicine_id, branchId, it.batch_no, it.expiry_date);
      let batchId;
      if (existing) {
        db.prepare(`UPDATE stock_batches SET qty = qty + ?, mrp = ?, purchase_price = ?, selling_price = ?, supplier_id = ? WHERE id = ?`)
          .run(qty + freeQty, it.mrp, it.purchase_price, it.selling_price || it.mrp, supplier_id, existing.id);
        batchId = existing.id;
      } else {
        batchId = db.prepare(`INSERT INTO stock_batches (medicine_id, branch_id, supplier_id, batch_no, expiry_date, mrp, purchase_price, selling_price, qty)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(it.medicine_id, branchId, supplier_id, it.batch_no, it.expiry_date, it.mrp, it.purchase_price, it.selling_price || it.mrp, qty + freeQty).lastInsertRowid;
      }
      db.prepare(`INSERT INTO purchase_items (purchase_id, medicine_id, batch_id, batch_no, expiry_date, qty, free_qty, purchase_price, mrp, selling_price, gst_rate, amount)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pid, it.medicine_id, batchId, it.batch_no, it.expiry_date, qty, freeQty, it.purchase_price, it.mrp, it.selling_price || it.mrp, med.gst_rate, amount);
      subtotal += amount - gst; gstAmt += gst;
    }
    const total = round2(subtotal + gstAmt);
    const paid = Math.min(Number(paid_amount) || 0, total);
    db.prepare('UPDATE purchases SET subtotal=?, gst_amount=?, total=?, paid_amount=? WHERE id=?')
      .run(round2(subtotal), round2(gstAmt), total, paid, pid);
    if (paid > 0) {
      db.prepare(`INSERT INTO supplier_payments (supplier_id, branch_id, purchase_id, amount, method, date, notes, created_by)
        VALUES (?,?,?,?,?,?,?,?)`).run(supplier_id, branchId, pid, paid, req.body.paid_method || 'bank', invoice_date, 'Paid with purchase entry', req.user.id);
    }
    return { pid, total, paid };
  });
  try {
    const { pid, total, paid } = tx();
    audit(req, 'create', 'purchases', pid, `${invoice_no} ₹${total}`);
    notify({ branch_id: branchId, role: 'branch_admin', type: 'purchase', title: 'New purchase entry', message: `Invoice ${invoice_no} for ₹${total} recorded${paid < total ? ` (₹${round2(total - paid)} pending)` : ''}.` });
    res.json({ id: pid, total });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------- Purchase returns ----------------
router.post('/:id(\\d+)/returns', requirePermission('purchases.manage'), (req, res) => {
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  const { items = [], reason = '' } = req.body || {};
  if (!items.length) return res.status(400).json({ error: 'Select items to return' });
  const tx = db.transaction(() => {
    let total = 0;
    const rid = db.prepare(`INSERT INTO purchase_returns (purchase_id, branch_id, supplier_id, reason, created_by)
      VALUES (?,?,?,?,?)`).run(purchase.id, purchase.branch_id, purchase.supplier_id, reason, req.user.id).lastInsertRowid;
    for (const it of items) {
      const pi = db.prepare('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?').get(it.purchase_item_id, purchase.id);
      if (!pi) throw new Error('Purchase item not found');
      const qty = Number(it.qty);
      if (!qty || qty <= 0 || qty > pi.qty + pi.free_qty) throw new Error('Invalid return quantity');
      const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(pi.batch_id);
      if (batch.qty < qty) throw new Error(`Only ${batch.qty} left in batch ${batch.batch_no}; cannot return ${qty}`);
      db.prepare('UPDATE stock_batches SET qty = qty - ? WHERE id = ?').run(qty, pi.batch_id);
      const amount = round2(qty * pi.purchase_price);
      db.prepare(`INSERT INTO purchase_return_items (return_id, medicine_id, batch_id, qty, amount) VALUES (?,?,?,?,?)`)
        .run(rid, pi.medicine_id, pi.batch_id, qty, amount);
      total += amount;
    }
    db.prepare('UPDATE purchase_returns SET amount = ? WHERE id = ?').run(round2(total), rid);
    return { rid, total: round2(total) };
  });
  try {
    const { rid, total } = tx();
    audit(req, 'purchase_return', 'purchase_returns', rid, `₹${total}`);
    res.json({ id: rid, amount: total });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/returns/list', requirePermission('purchases.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const rows = db.prepare(`SELECT r.*, s.name AS supplier_name, b.name AS branch_name, p.invoice_no
    FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id JOIN branches b ON b.id = r.branch_id
    LEFT JOIN purchases p ON p.id = r.purchase_id
    ${branchId ? 'WHERE r.branch_id = ?' : ''} ORDER BY r.id DESC LIMIT 100`)
    .all(...(branchId ? [branchId] : []));
  res.json({ returns: rows });
});

// Pending supplier dues
router.get('/dues/summary', requirePermission('purchases.view', 'accounts.manage', 'dashboard.view'), (req, res) => {
  const suppliers = db.prepare('SELECT * FROM suppliers WHERE active = 1').all();
  const dues = suppliers.map(s => ({ id: s.id, name: s.name, phone: s.phone, balance: supplierBalance(s.id) }))
    .filter(s => s.balance > 0).sort((a, b) => b.balance - a.balance);
  res.json({ dues, total: round2(dues.reduce((a, s) => a + s.balance, 0)) });
});

export default router;
