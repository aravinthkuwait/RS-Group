import { Router } from 'express';
import db from '../db.js';
import { requirePermission, scopeBranch, writeBranch } from '../auth.js';
import { audit, notify, checkStockAlerts, today, broadcast } from '../util.js';

const router = Router();

// ---------------- Medicines master ----------------
router.get('/medicines', requirePermission('inventory.view', 'billing.create'), (req, res) => {
  const { q = '', category = '', page = 1, limit = 50 } = req.query;
  const branchId = scopeBranch(req);
  const where = ['m.active = 1'];
  const params = [];
  if (q) {
    where.push('(m.name LIKE ? OR m.generic_name LIKE ? OR m.brand LIKE ? OR m.barcode = ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (category) { where.push('m.category = ?'); params.push(category); }
  const stockJoin = branchId
    ? `LEFT JOIN (SELECT medicine_id, SUM(qty) AS stock FROM stock_batches WHERE branch_id = ${Number(branchId)} GROUP BY medicine_id) s ON s.medicine_id = m.id`
    : `LEFT JOIN (SELECT medicine_id, SUM(qty) AS stock FROM stock_batches GROUP BY medicine_id) s ON s.medicine_id = m.id`;
  const total = db.prepare(`SELECT COUNT(*) c FROM medicines m WHERE ${where.join(' AND ')}`).get(...params).c;
  const rows = db.prepare(`SELECT m.*, COALESCE(s.stock, 0) AS stock FROM medicines m ${stockJoin}
    WHERE ${where.join(' AND ')} ORDER BY m.name LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), (Number(page) - 1) * Number(limit));
  res.json({ medicines: rows, total, page: Number(page), limit: Number(limit) });
});

// Fast POS search: matches name / generic / barcode / batch number and returns sellable batches
router.get('/medicines/pos-search', requirePermission('billing.create', 'inventory.view'), (req, res) => {
  const { q = '' } = req.query;
  const branchId = scopeBranch(req) || req.user.branch_id;
  if (!q || !branchId) return res.json({ results: [] });
  const rows = db.prepare(`
    SELECT m.id, m.name, m.generic_name, m.category, m.brand, m.gst_rate, m.unit, m.rack_location, m.prescription_required,
           b.id AS batch_id, b.batch_no, b.expiry_date, b.mrp, b.selling_price, b.qty
    FROM medicines m
    JOIN stock_batches b ON b.medicine_id = m.id AND b.branch_id = ? AND b.qty > 0
    WHERE m.active = 1 AND (m.name LIKE ? OR m.generic_name LIKE ? OR m.barcode = ? OR b.batch_no = ?)
      AND b.expiry_date >= date('now')
    ORDER BY m.name, b.expiry_date LIMIT 30`)
    .all(branchId, `%${q}%`, `%${q}%`, q, q);
  res.json({ results: rows });
});

router.post('/medicines', requirePermission('inventory.edit'), (req, res) => {
  const { name, generic_name = '', category = 'General', brand = '', barcode = null, hsn = '3004',
    gst_rate = 12, unit = 'Strip', rack_location = '', min_stock = 10, prescription_required = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Medicine name is required' });
  const info = db.prepare(`INSERT INTO medicines (name, generic_name, category, brand, barcode, hsn, gst_rate, unit, rack_location, min_stock, prescription_required)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(name.trim(), generic_name, category, brand, barcode || null, hsn, gst_rate, unit, rack_location, min_stock, prescription_required ? 1 : 0);
  audit(req, 'create', 'medicines', info.lastInsertRowid, name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/medicines/:id', requirePermission('inventory.edit'), (req, res) => {
  const f = req.body || {};
  db.prepare(`UPDATE medicines SET name=COALESCE(?,name), generic_name=COALESCE(?,generic_name),
    category=COALESCE(?,category), brand=COALESCE(?,brand), barcode=COALESCE(?,barcode), hsn=COALESCE(?,hsn),
    gst_rate=COALESCE(?,gst_rate), unit=COALESCE(?,unit), rack_location=COALESCE(?,rack_location),
    min_stock=COALESCE(?,min_stock), prescription_required=COALESCE(?,prescription_required), active=COALESCE(?,active)
    WHERE id=?`)
    .run(f.name, f.generic_name, f.category, f.brand, f.barcode, f.hsn, f.gst_rate, f.unit,
      f.rack_location, f.min_stock, f.prescription_required, f.active, req.params.id);
  audit(req, 'update', 'medicines', Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/medicines/:id', requirePermission('inventory.edit'), (req, res) => {
  db.prepare('UPDATE medicines SET active = 0 WHERE id = ?').run(req.params.id);
  audit(req, 'deactivate', 'medicines', Number(req.params.id));
  res.json({ ok: true });
});

// ---------------- Stock (batch level) ----------------
router.get('/stock', requirePermission('inventory.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const { q = '', medicine_id } = req.query;
  const where = ['1=1'];
  const params = [];
  if (branchId) { where.push('b.branch_id = ?'); params.push(branchId); }
  if (medicine_id) { where.push('b.medicine_id = ?'); params.push(medicine_id); }
  if (q) { where.push('(m.name LIKE ? OR b.batch_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT b.*, m.name AS medicine_name, m.unit, m.min_stock, m.rack_location, m.category,
      br.name AS branch_name, br.code AS branch_code,
      CAST(julianday(b.expiry_date) - julianday('now') AS INTEGER) AS days_to_expiry
    FROM stock_batches b
    JOIN medicines m ON m.id = b.medicine_id
    JOIN branches br ON br.id = b.branch_id
    WHERE ${where.join(' AND ')} AND (b.qty > 0 OR b.damaged_qty > 0)
    ORDER BY m.name, b.expiry_date LIMIT 500`).all(...params);
  res.json({ stock: rows });
});

// ---------------- Alerts: expiry / low stock / out of stock / movers ----------------
router.get('/alerts', requirePermission('inventory.view', 'dashboard.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const bw = branchId ? 'AND b.branch_id = ?' : '';
  const bp = branchId ? [branchId] : [];

  const expiring = (days) => db.prepare(`SELECT b.*, m.name AS medicine_name, m.unit, br.name AS branch_name,
      CAST(julianday(b.expiry_date) - julianday('now') AS INTEGER) AS days_to_expiry
    FROM stock_batches b JOIN medicines m ON m.id = b.medicine_id JOIN branches br ON br.id = b.branch_id
    WHERE b.qty > 0 AND b.expiry_date >= date('now') AND b.expiry_date <= date('now', '+${days} days') ${bw}
    ORDER BY b.expiry_date`).all(...bp);

  const expired = db.prepare(`SELECT b.*, m.name AS medicine_name, m.unit, br.name AS branch_name,
      CAST(julianday('now') - julianday(b.expiry_date) AS INTEGER) AS days_expired
    FROM stock_batches b JOIN medicines m ON m.id = b.medicine_id JOIN branches br ON br.id = b.branch_id
    WHERE b.qty > 0 AND b.expiry_date < date('now') ${bw} ORDER BY b.expiry_date`).all(...bp);

  const stockByMed = db.prepare(`SELECT m.id, m.name, m.unit, m.min_stock, COALESCE(SUM(b.qty),0) AS stock
    FROM medicines m LEFT JOIN stock_batches b ON b.medicine_id = m.id ${branchId ? 'AND b.branch_id = ?' : ''}
    WHERE m.active = 1 GROUP BY m.id`).all(...bp);
  const lowStock = stockByMed.filter(r => r.stock > 0 && r.stock <= r.min_stock);
  const outOfStock = stockByMed.filter(r => r.stock <= 0);

  const movers = db.prepare(`SELECT m.id, m.name, m.unit, COALESCE(SUM(si.qty),0) AS sold_30d
    FROM medicines m
    LEFT JOIN sale_items si ON si.medicine_id = m.id
    LEFT JOIN sales s ON s.id = si.sale_id AND s.status NOT IN ('cancelled','held') AND s.created_at >= datetime('now','-30 days') ${branchId ? 'AND s.branch_id = ?' : ''}
    WHERE m.active = 1 GROUP BY m.id ORDER BY sold_30d DESC`).all(...bp);
  const fastMoving = movers.slice(0, 10).filter(m => m.sold_30d > 0);
  const slowMoving = movers.filter(m => m.sold_30d <= 1).slice(0, 10);

  // Near-expiry discount suggestions: items expiring in 90 days with stock — suggest a discount to clear
  const discountSuggestions = expiring(90).map(b => ({
    ...b,
    suggested_discount_pct: b.days_to_expiry <= 30 ? 30 : b.days_to_expiry <= 60 ? 20 : 10,
    stock_value: Math.round(b.qty * b.selling_price * 100) / 100,
  }));

  res.json({
    expiring_30: expiring(30), expiring_60: expiring(60), expiring_90: expiring(90),
    expired, low_stock: lowStock, out_of_stock: outOfStock,
    fast_moving: fastMoving, slow_moving: slowMoving,
    discount_suggestions: discountSuggestions,
  });
});

// ---------------- Stock adjustment (with reason) & damaged stock ----------------
router.post('/adjustments', requirePermission('inventory.adjust'), (req, res) => {
  const { batch_id, qty_change, type = 'adjustment', reason } = req.body || {};
  if (!batch_id || !qty_change || !reason) return res.status(400).json({ error: 'Batch, quantity change and reason are required' });
  const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(batch_id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (!['super_admin'].includes(req.user.role) && batch.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Batch belongs to another branch' });
  }
  const change = Number(qty_change);
  if (batch.qty + change < 0) return res.status(400).json({ error: `Only ${batch.qty} in stock; cannot reduce by ${-change}` });
  const tx = db.transaction(() => {
    db.prepare('UPDATE stock_batches SET qty = qty + ? WHERE id = ?').run(change, batch_id);
    if (type === 'damage' && change < 0) {
      db.prepare('UPDATE stock_batches SET damaged_qty = damaged_qty + ? WHERE id = ?').run(-change, batch_id);
    }
    db.prepare(`INSERT INTO stock_adjustments (branch_id, medicine_id, batch_id, qty_change, type, reason, created_by)
      VALUES (?,?,?,?,?,?,?)`)
      .run(batch.branch_id, batch.medicine_id, batch_id, change, type, reason, req.user.id);
  });
  tx();
  audit(req, 'stock_adjustment', 'stock_batches', batch_id, `${change} (${type}): ${reason}`);
  checkStockAlerts(batch.medicine_id, batch.branch_id);
  broadcast('stock_changed', { medicine_id: batch.medicine_id, branch_id: batch.branch_id }, batch.branch_id);
  res.json({ ok: true });
});

router.get('/adjustments', requirePermission('inventory.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const rows = db.prepare(`SELECT a.*, m.name AS medicine_name, b.batch_no, u.name AS user_name, br.name AS branch_name
    FROM stock_adjustments a
    JOIN medicines m ON m.id = a.medicine_id
    JOIN stock_batches b ON b.id = a.batch_id
    LEFT JOIN users u ON u.id = a.created_by
    JOIN branches br ON br.id = a.branch_id
    ${branchId ? 'WHERE a.branch_id = ?' : ''} ORDER BY a.id DESC LIMIT 200`)
    .all(...(branchId ? [branchId] : []));
  res.json({ adjustments: rows });
});

// ---------------- Stock transfers between branches ----------------
router.get('/transfers', requirePermission('inventory.view', 'inventory.transfer'), (req, res) => {
  const branchId = scopeBranch(req);
  const rows = db.prepare(`SELECT t.*, fb.name AS from_branch, tb.name AS to_branch, u.name AS created_by_name
    FROM stock_transfers t
    JOIN branches fb ON fb.id = t.from_branch_id JOIN branches tb ON tb.id = t.to_branch_id
    LEFT JOIN users u ON u.id = t.created_by
    ${branchId ? 'WHERE t.from_branch_id = ? OR t.to_branch_id = ?' : ''}
    ORDER BY t.id DESC LIMIT 100`).all(...(branchId ? [branchId, branchId] : []));
  const items = db.prepare(`SELECT ti.*, m.name AS medicine_name, b.batch_no, b.expiry_date
    FROM stock_transfer_items ti JOIN medicines m ON m.id = ti.medicine_id JOIN stock_batches b ON b.id = ti.batch_id
    WHERE ti.transfer_id IN (${rows.map(r => r.id).join(',') || '0'})`).all();
  res.json({ transfers: rows.map(t => ({ ...t, items: items.filter(i => i.transfer_id === t.id) })) });
});

router.post('/transfers', requirePermission('inventory.transfer'), (req, res) => {
  const { to_branch_id, items = [], notes = '' } = req.body || {};
  const fromBranchId = writeBranch(req, req.body.from_branch_id);
  if (!fromBranchId || !to_branch_id || fromBranchId === to_branch_id) return res.status(400).json({ error: 'Choose a different destination branch' });
  if (!items.length) return res.status(400).json({ error: 'Add at least one item' });

  const tx = db.transaction(() => {
    // Deduct from source immediately (goods in transit); destination receives on completion
    for (const it of items) {
      const batch = db.prepare('SELECT * FROM stock_batches WHERE id = ? AND branch_id = ?').get(it.batch_id, fromBranchId);
      if (!batch) throw new Error('Batch not found in source branch');
      if (batch.qty < it.qty) throw new Error(`Insufficient stock in batch ${batch.batch_no} (available ${batch.qty})`);
      db.prepare('UPDATE stock_batches SET qty = qty - ? WHERE id = ?').run(it.qty, it.batch_id);
    }
    const tid = db.prepare(`INSERT INTO stock_transfers (from_branch_id, to_branch_id, notes, created_by)
      VALUES (?,?,?,?)`).run(fromBranchId, to_branch_id, notes, req.user.id).lastInsertRowid;
    const ins = db.prepare('INSERT INTO stock_transfer_items (transfer_id, medicine_id, batch_id, qty) VALUES (?,?,?,?)');
    for (const it of items) {
      const batch = db.prepare('SELECT medicine_id FROM stock_batches WHERE id = ?').get(it.batch_id);
      ins.run(tid, batch.medicine_id, it.batch_id, it.qty);
    }
    return tid;
  });
  try {
    const tid = tx();
    audit(req, 'create', 'stock_transfers', tid);
    notify({ branch_id: to_branch_id, type: 'transfer', title: 'Incoming stock transfer', message: `Transfer #${tid} is on the way. Receive it from the Transfers page.` });
    res.json({ id: tid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/transfers/:id/receive', requirePermission('inventory.transfer'), (req, res) => {
  const t = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });
  if (t.status !== 'pending') return res.status(400).json({ error: `Transfer already ${t.status}` });
  if (req.user.role !== 'super_admin' && req.user.branch_id !== t.to_branch_id) {
    return res.status(403).json({ error: 'Only the destination branch can receive this transfer' });
  }
  const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(t.id);
  const tx = db.transaction(() => {
    for (const it of items) {
      const src = db.prepare('SELECT * FROM stock_batches WHERE id = ?').get(it.batch_id);
      // Create/merge an identical batch at the destination branch
      const existing = db.prepare(`SELECT id FROM stock_batches WHERE medicine_id=? AND branch_id=? AND batch_no=? AND expiry_date=?`)
        .get(src.medicine_id, t.to_branch_id, src.batch_no, src.expiry_date);
      if (existing) {
        db.prepare('UPDATE stock_batches SET qty = qty + ? WHERE id = ?').run(it.qty, existing.id);
      } else {
        db.prepare(`INSERT INTO stock_batches (medicine_id, branch_id, supplier_id, batch_no, expiry_date, mrp, purchase_price, selling_price, qty)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(src.medicine_id, t.to_branch_id, src.supplier_id, src.batch_no, src.expiry_date, src.mrp, src.purchase_price, src.selling_price, it.qty);
      }
    }
    db.prepare(`UPDATE stock_transfers SET status='completed', completed_by=?, completed_at=datetime('now') WHERE id=?`)
      .run(req.user.id, t.id);
  });
  tx();
  audit(req, 'receive', 'stock_transfers', t.id);
  broadcast('stock_changed', { branch_id: t.to_branch_id }, t.to_branch_id);
  res.json({ ok: true });
});

router.post('/transfers/:id/cancel', requirePermission('inventory.transfer'), (req, res) => {
  const t = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(req.params.id);
  if (!t || t.status !== 'pending') return res.status(400).json({ error: 'Only pending transfers can be cancelled' });
  if (req.user.role !== 'super_admin' && req.user.branch_id !== t.from_branch_id) {
    return res.status(403).json({ error: 'Only the source branch can cancel this transfer' });
  }
  const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(t.id);
  const tx = db.transaction(() => {
    for (const it of items) db.prepare('UPDATE stock_batches SET qty = qty + ? WHERE id = ?').run(it.qty, it.batch_id);
    db.prepare(`UPDATE stock_transfers SET status='cancelled' WHERE id=?`).run(t.id);
  });
  tx();
  audit(req, 'cancel', 'stock_transfers', t.id);
  res.json({ ok: true });
});

export default router;
