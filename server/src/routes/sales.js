import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { requirePermission, can, scopeBranch, writeBranch } from '../auth.js';
import { audit, broadcast, nextInvoiceNo, checkStockAlerts, round2, today } from '../util.js';
import { invoicePdf } from '../pdf.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function saleWithDetails(id) {
  const sale = await get(`SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
      u.name AS staff_name, b.name AS branch_name, b.code AS branch_code,
      d.name AS delivery_staff_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.staff_id LEFT JOIN users d ON d.id = s.delivery_staff_id
    JOIN branches b ON b.id = s.branch_id WHERE s.id = ?`, id);
  if (!sale) return null;
  sale.items = await all(`SELECT si.*, m.name AS medicine_name, m.unit FROM sale_items si
    JOIN medicines m ON m.id = si.medicine_id WHERE si.sale_id = ?`, id);
  return sale;
}

// ---------------- List / filters ----------------
router.get('/', requirePermission('billing.view', 'billing.create'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const { from, to, status, staff_id, customer_id, payment, q, page = 1, limit = 50 } = req.query;
  const where = ["s.status != 'held' OR ? = 1"]; const params = [status === 'held' ? 1 : 0];
  if (branchId) { where.push('s.branch_id = ?'); params.push(branchId); }
  if (from) { where.push('s.created_at::date >= ?'); params.push(from); }
  if (to) { where.push('s.created_at::date <= ?'); params.push(to); }
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (staff_id) { where.push('s.staff_id = ?'); params.push(staff_id); }
  if (customer_id) { where.push('s.customer_id = ?'); params.push(customer_id); }
  if (payment === 'cash') where.push('s.paid_cash > 0');
  if (payment === 'upi') where.push('s.paid_upi > 0');
  if (payment === 'card') where.push('s.paid_card > 0');
  if (payment === 'credit') where.push('s.credit_amount > 0');
  if (q) { where.push('(s.invoice_no ILIKE ? OR c.name ILIKE ? OR c.phone ILIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const base = `FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.staff_id JOIN branches b ON b.id = s.branch_id
    WHERE ${where.map(w => `(${w})`).join(' AND ')}`;
  const total = (await get(`SELECT COUNT(*) AS c ${base}`, ...params)).c;
  const rows = await all(`SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS staff_name, b.name AS branch_name ${base}
    ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`, ...params, Number(limit), (Number(page) - 1) * Number(limit));
  res.json({ sales: rows, total, page: Number(page) });
}));

router.get('/held', requirePermission('billing.create'), wrap(async (req, res) => {
  const branchId = writeBranch(req, req.query.branch_id);
  const rows = await all(`SELECT s.id FROM sales s WHERE s.status = 'held' AND s.branch_id = ? ORDER BY s.id DESC`, branchId);
  const sales = [];
  for (const r of rows) sales.push(await saleWithDetails(r.id));
  res.json({ sales });
}));

router.get('/:id(\\d+)', requirePermission('billing.view', 'billing.create'), wrap(async (req, res) => {
  const sale = await saleWithDetails(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Bill not found' });
  res.json({ sale });
}));

// ---------------- Create bill (POS) ----------------
// items: [{ batch_id, qty, price? }], payment: { cash, upi, card, credit }
router.post('/', requirePermission('billing.create'), wrap(async (req, res) => {
  const { items = [], customer_id = null, customer_phone = null, discount = 0,
    payment = {}, doctor_name = '', notes = '', hold = false, prescription_file = null,
    resume_sale_id = null, delivery = null } = req.body || {};
  const branchId = writeBranch(req, req.body.branch_id);
  if (!branchId) return res.status(400).json({ error: 'No branch assigned to your account' });
  if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
  if (Number(discount) > 0 && !hold && !can(req.user, 'billing.discount')) {
    return res.status(403).json({ error: 'You do not have permission to apply discounts' });
  }
  if (prescription_file && prescription_file.length > 2_000_000) {
    return res.status(400).json({ error: 'Prescription file too large (max ~1.5MB)' });
  }

  try {
    const result = await tx(async db => {
      // Resolve customer by phone (auto-create light profile)
      let custId = customer_id;
      if (!custId && customer_phone) {
        const existing = await db.get('SELECT id FROM customers WHERE phone = ?', customer_phone.trim());
        custId = existing ? existing.id
          : await db.insert('INSERT INTO customers (branch_id, name, phone) VALUES (?,?,?)',
            branchId, req.body.customer_name || 'Customer ' + customer_phone.slice(-4), customer_phone.trim());
      }

      // If resuming a held bill, release it (its stock was never deducted for held bills)
      if (resume_sale_id) {
        const held = await db.get(`SELECT * FROM sales WHERE id = ? AND status = 'held' AND branch_id = ?`, resume_sale_id, branchId);
        if (held) {
          await db.run('DELETE FROM sale_items WHERE sale_id = ?', held.id);
          await db.run('DELETE FROM sales WHERE id = ?', held.id);
        }
      }

      let subtotal = 0, gstTotal = 0;
      const lineItems = [];
      for (const it of items) {
        const batch = await db.get(`SELECT b.*, m.name AS medicine_name, m.gst_rate AS med_gst, m.prescription_required
          FROM stock_batches b JOIN medicines m ON m.id = b.medicine_id WHERE b.id = ?`, it.batch_id);
        if (!batch) throw new Error('Selected batch not found');
        if (batch.branch_id !== branchId) throw new Error(`${batch.medicine_name}: batch belongs to another branch`);
        const qty = Number(it.qty);
        if (!qty || qty <= 0) throw new Error(`${batch.medicine_name}: invalid quantity`);
        if (!hold) {
          if (batch.qty < qty) throw new Error(`${batch.medicine_name} (batch ${batch.batch_no}): only ${batch.qty} in stock`);
          if (batch.expiry_date < today()) throw new Error(`${batch.medicine_name} (batch ${batch.batch_no}) is expired and cannot be sold`);
        }
        const price = it.price != null ? Number(it.price) : batch.selling_price;
        if (price > batch.mrp) throw new Error(`${batch.medicine_name}: price cannot exceed MRP ₹${batch.mrp}`);
        const lineTotal = round2(qty * price);
        const gst = round2(lineTotal * batch.med_gst / (100 + batch.med_gst));
        subtotal += lineTotal; gstTotal += gst;
        lineItems.push({ batch, qty, price, lineTotal, gst });
      }
      subtotal = round2(subtotal);
      const disc = Math.min(Number(discount) || 0, subtotal);
      const gross = subtotal - disc;
      const total = hold ? round2(gross) : Math.round(gross);
      const roundOff = round2(total - gross);

      let cash = 0, upi = 0, card = 0, credit = 0;
      if (!hold) {
        cash = round2(Number(payment.cash) || 0);
        upi = round2(Number(payment.upi) || 0);
        card = round2(Number(payment.card) || 0);
        credit = round2(Number(payment.credit) || 0);
        const paidSum = round2(cash + upi + card + credit);
        if (Math.abs(paidSum - total) > 0.01) throw new Error(`Payment (₹${paidSum}) does not match bill total (₹${total})`);
        if (credit > 0 && !custId) throw new Error('Credit sales need a customer mobile number');
      }

      const invoiceNo = await nextInvoiceNo(branchId, db);
      const saleId = await db.insert(`INSERT INTO sales (invoice_no, branch_id, customer_id, staff_id, subtotal, discount, gst_amount, round_off, total,
          paid_cash, paid_upi, paid_card, credit_amount, status, doctor_name, prescription_file, notes,
          delivery_status, delivery_address)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        invoiceNo, branchId, custId, req.user.id, subtotal, disc, round2(gstTotal), roundOff, total,
        cash, upi, card, credit, hold ? 'held' : 'completed', doctor_name, prescription_file, notes,
        delivery ? 'pending' : null, delivery?.address || null);

      for (const li of lineItems) {
        await db.run(`INSERT INTO sale_items (sale_id, medicine_id, batch_id, batch_no, qty, mrp, price, purchase_price, gst_rate, gst_amount, discount, total)
          VALUES (?,?,?,?,?,?,?,?,?,?,0,?)`,
          saleId, li.batch.medicine_id, li.batch.id, li.batch.batch_no, li.qty, li.batch.mrp, li.price,
          li.batch.purchase_price, li.batch.med_gst, li.gst, li.lineTotal);
        if (!hold) await db.run('UPDATE stock_batches SET qty = qty - ? WHERE id = ?', li.qty, li.batch.id);
      }
      if (!hold && custId) {
        await db.run('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?', Math.floor(total / 100), custId);
      }
      return { saleId, invoiceNo, total, lineItems };
    });

    const { saleId, invoiceNo, total, lineItems } = result;
    audit(req, hold ? 'hold_bill' : 'create_bill', 'sales', saleId, `${invoiceNo} ₹${total}`);
    if (!hold) {
      for (const li of lineItems) await checkStockAlerts(li.batch.medicine_id, branchId);
      broadcast('sale_created', { id: saleId, invoice_no: invoiceNo, total, branch_id: branchId }, branchId);
    }
    res.json({ id: saleId, invoice_no: invoiceNo, total, sale: await saleWithDetails(saleId) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

// ---------------- Cancel bill ----------------
router.post('/:id(\\d+)/cancel', requirePermission('billing.cancel'), wrap(async (req, res) => {
  const sale = await get('SELECT * FROM sales WHERE id = ?', req.params.id);
  if (!sale) return res.status(404).json({ error: 'Bill not found' });
  if (!['completed', 'held'].includes(sale.status)) return res.status(400).json({ error: `Cannot cancel a ${sale.status} bill` });
  if (req.user.role !== 'super_admin' && sale.branch_id !== req.user.branch_id) return res.status(403).json({ error: 'Bill belongs to another branch' });
  const items = await all('SELECT * FROM sale_items WHERE sale_id = ?', sale.id);
  await tx(async db => {
    if (sale.status === 'completed') {
      for (const it of items) {
        if (it.batch_id) await db.run('UPDATE stock_batches SET qty = qty + ? WHERE id = ?', it.qty - it.returned_qty, it.batch_id);
      }
    }
    await db.run(`UPDATE sales SET status = 'cancelled' WHERE id = ?`, sale.id);
  });
  audit(req, 'cancel_bill', 'sales', sale.id, `${sale.invoice_no} — ${req.body?.reason || ''}`);
  res.json({ ok: true });
}));

// ---------------- Returns / refunds ----------------
router.post('/:id(\\d+)/returns', requirePermission('billing.return'), wrap(async (req, res) => {
  const sale = await get('SELECT * FROM sales WHERE id = ?', req.params.id);
  if (!sale) return res.status(404).json({ error: 'Bill not found' });
  if (!['completed', 'partial_return'].includes(sale.status)) return res.status(400).json({ error: `Cannot return items on a ${sale.status} bill` });
  if (req.user.role !== 'super_admin' && sale.branch_id !== req.user.branch_id) return res.status(403).json({ error: 'Bill belongs to another branch' });
  const { items = [], reason = '', refund_method = 'cash' } = req.body || {};
  if (!items.length) return res.status(400).json({ error: 'Select items to return' });

  try {
    const { rid, refund } = await tx(async db => {
      let refund = 0;
      const rid = await db.insert(`INSERT INTO returns (sale_id, branch_id, customer_id, staff_id, reason, refund_method)
        VALUES (?,?,?,?,?,?)`, sale.id, sale.branch_id, sale.customer_id, req.user.id, reason, refund_method);
      for (const it of items) {
        const si = await db.get('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', it.sale_item_id, sale.id);
        if (!si) throw new Error('Bill item not found');
        const qty = Number(it.qty);
        const returnable = si.qty - si.returned_qty;
        if (!qty || qty <= 0 || qty > returnable) throw new Error(`Invalid return quantity (max ${returnable})`);
        const amount = round2(qty * si.price);
        await db.run('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?', qty, si.id);
        if (si.batch_id) await db.run('UPDATE stock_batches SET qty = qty + ? WHERE id = ?', qty, si.batch_id);
        await db.run(`INSERT INTO return_items (return_id, sale_item_id, medicine_id, batch_id, qty, amount)
          VALUES (?,?,?,?,?,?)`, rid, si.id, si.medicine_id, si.batch_id, qty, amount);
        refund += amount;
      }
      refund = round2(refund);
      await db.run('UPDATE returns SET refund_amount = ? WHERE id = ?', refund, rid);
      const allReturned = (await db.get(`SELECT COUNT(*) AS c FROM sale_items WHERE sale_id = ? AND returned_qty < qty`, sale.id)).c === 0;
      await db.run('UPDATE sales SET status = ? WHERE id = ?', allReturned ? 'returned' : 'partial_return', sale.id);
      if (refund_method === 'credit_note' && sale.customer_id) {
        await db.run(`INSERT INTO payments (branch_id, customer_id, amount, method, type, date, notes, created_by)
          VALUES (?,?,?,?,?,?,?,?)`,
          sale.branch_id, sale.customer_id, refund, 'credit_note', 'receipt', today(), `Credit note for return on ${sale.invoice_no}`, req.user.id);
      }
      return { rid, refund };
    });
    audit(req, 'return_bill', 'returns', rid, `${sale.invoice_no} refund ₹${refund}`);
    broadcast('stock_changed', { branch_id: sale.branch_id }, sale.branch_id);
    res.json({ id: rid, refund_amount: refund });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

router.get('/returns/list', requirePermission('billing.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const rows = await all(`SELECT r.*, s.invoice_no, c.name AS customer_name, u.name AS staff_name, b.name AS branch_name
    FROM returns r JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN users u ON u.id = r.staff_id JOIN branches b ON b.id = r.branch_id
    ${branchId ? 'WHERE r.branch_id = ?' : ''} ORDER BY r.id DESC LIMIT 200`,
    ...(branchId ? [branchId] : []));
  res.json({ returns: rows });
}));

// ---------------- Invoice PDF + share ----------------
router.get('/:id(\\d+)/pdf', requirePermission('billing.view', 'billing.create'), wrap(async (req, res) => {
  const sale = await saleWithDetails(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Bill not found' });
  const branch = await get('SELECT * FROM branches WHERE id = ?', sale.branch_id);
  const customer = sale.customer_id ? await get('SELECT * FROM customers WHERE id = ?', sale.customer_id) : null;
  await invoicePdf(res, sale, sale.items, branch, customer, { name: sale.staff_name });
}));

// WhatsApp share: returns a wa.me deep link with the bill summary
router.get('/:id(\\d+)/whatsapp', requirePermission('billing.view', 'billing.create'), wrap(async (req, res) => {
  const sale = await saleWithDetails(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Bill not found' });
  const lines = sale.items.map(i => `• ${i.medicine_name} x${i.qty} = ₹${i.total.toFixed(2)}`).join('\n');
  const msg = `*${sale.branch_name}*\nInvoice: ${sale.invoice_no}\nDate: ${sale.created_at}\n\n${lines}\n\n*Total: ₹${sale.total.toFixed(2)}*\n\nThank you for shopping with RS Group! Get well soon.`;
  const phone = (sale.customer_phone || '').replace(/[^0-9]/g, '');
  res.json({ url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, message: msg });
}));

// ---------------- Deliveries ----------------
router.get('/deliveries/list', requirePermission('delivery.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const where = ['s.delivery_status IS NOT NULL']; const params = [];
  if (branchId) { where.push('s.branch_id = ?'); params.push(branchId); }
  if (req.user.role === 'delivery_staff') { where.push('(s.delivery_staff_id = ? OR s.delivery_staff_id IS NULL)'); params.push(req.user.id); }
  const rows = await all(`SELECT s.id, s.invoice_no, s.total, s.delivery_status, s.delivery_address, s.delivered_at, s.created_at,
      c.name AS customer_name, c.phone AS customer_phone, u.name AS delivery_staff_name, b.name AS branch_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.delivery_staff_id JOIN branches b ON b.id = s.branch_id
    WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 200`, ...params);
  res.json({ deliveries: rows });
}));

router.post('/:id(\\d+)/delivery', requirePermission('delivery.update'), wrap(async (req, res) => {
  const { status, address } = req.body || {};
  if (!['pending', 'out_for_delivery', 'delivered', 'failed'].includes(status)) return res.status(400).json({ error: 'Invalid delivery status' });
  const sale = await get('SELECT * FROM sales WHERE id = ?', req.params.id);
  if (!sale) return res.status(404).json({ error: 'Bill not found' });
  await run(`UPDATE sales SET delivery_status = ?, delivery_staff_id = ?, delivery_address = COALESCE(?, delivery_address),
    delivered_at = CASE WHEN ? = 'delivered' THEN now() ELSE delivered_at END WHERE id = ?`,
    status, req.user.role === 'delivery_staff' ? req.user.id : (req.body.delivery_staff_id || sale.delivery_staff_id), address, status, sale.id);
  audit(req, 'delivery_update', 'sales', sale.id, status);
  res.json({ ok: true });
}));

export default router;
