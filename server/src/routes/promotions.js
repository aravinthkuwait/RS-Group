import { Router } from 'express';
import { all, get, run, insert } from '../db.js';
import { requirePermission, canAccessBranch } from '../auth.js';
import { audit, auditDiff, today } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const withNames = `SELECT p.*, b.name AS branch_name, m.name AS medicine_name, u.name AS created_by_name
  FROM promotions p LEFT JOIN branches b ON b.id = p.branch_id
  LEFT JOIN medicines m ON m.id = p.medicine_id LEFT JOIN users u ON u.id = p.created_by`;

// All promotion schemes (management view)
router.get('/', requirePermission('discounts.manage', 'billing.create', 'reports.view'), wrap(async (req, res) => {
  res.json({ promotions: await all(`${withNames} ORDER BY p.to_date DESC, p.id DESC LIMIT 200`) });
}));

// Offers valid today for a branch — used by the POS discount picker
router.get('/active', requirePermission('billing.create'), wrap(async (req, res) => {
  const branchId = Number(req.query.branch_id) || req.user.branch_id;
  const rows = await all(`${withNames}
    WHERE p.active = 1 AND p.from_date <= ? AND p.to_date >= ?
      AND (p.branch_id IS NULL OR p.branch_id = ?)
    ORDER BY p.name`, today(), today(), branchId || -1);
  res.json({ promotions: rows });
}));

router.post('/', requirePermission('discounts.manage'), wrap(async (req, res) => {
  const { name, description = '', branch_id = null, discount_type = 'percent', discount_value,
    applies_to = 'all', category = '', medicine_id = null, min_bill_amount = 0,
    from_date, to_date } = req.body || {};
  if (!name || !from_date || !to_date) return res.status(400).json({ error: 'Name, from date and to date are required' });
  if (!['percent', 'amount'].includes(discount_type)) return res.status(400).json({ error: 'Invalid discount type' });
  const value = Number(discount_value);
  if (!value || value <= 0 || (discount_type === 'percent' && value > 100)) {
    return res.status(400).json({ error: 'Enter a valid discount value' });
  }
  if (to_date < from_date) return res.status(400).json({ error: 'To date must be after from date' });
  if (branch_id && !canAccessBranch(req.user, branch_id)) return res.status(403).json({ error: 'You are not assigned to that branch' });
  const id = await insert(`INSERT INTO promotions (name, description, branch_id, discount_type, discount_value,
      applies_to, category, medicine_id, min_bill_amount, from_date, to_date, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    name.trim(), description, branch_id || null, discount_type, value,
    applies_to, applies_to === 'category' ? category : '', applies_to === 'medicine' ? medicine_id : null,
    Number(min_bill_amount) || 0, from_date, to_date, req.user.id);
  audit(req, 'create', 'promotions', id, name);
  res.json({ id });
}));

router.put('/:id(\\d+)', requirePermission('discounts.manage'), wrap(async (req, res) => {
  const before = await get('SELECT * FROM promotions WHERE id = ?', req.params.id);
  if (!before) return res.status(404).json({ error: 'Offer not found' });
  const f = req.body || {};
  if (f.discount_type && !['percent', 'amount'].includes(f.discount_type)) return res.status(400).json({ error: 'Invalid discount type' });
  // Keep category/medicine_id consistent with the (possibly changed) offer type,
  // mirroring the create route — a medicine offer switched to "all bills" must
  // not keep its old medicine_id.
  const appliesTo = f.applies_to || before.applies_to;
  const category = appliesTo === 'category' ? (f.category !== undefined ? f.category : before.category) : '';
  const medicineId = appliesTo === 'medicine'
    ? (f.medicine_id !== undefined ? (f.medicine_id || null) : before.medicine_id)
    : null;
  await run(`UPDATE promotions SET name=COALESCE(?,name), description=COALESCE(?,description),
    branch_id=?, discount_type=COALESCE(?,discount_type), discount_value=COALESCE(?,discount_value),
    applies_to=COALESCE(?,applies_to), category=?, medicine_id=?,
    min_bill_amount=COALESCE(?,min_bill_amount), from_date=COALESCE(?,from_date),
    to_date=COALESCE(?,to_date), active=COALESCE(?,active) WHERE id=?`,
    f.name, f.description,
    f.branch_id !== undefined ? (f.branch_id || null) : before.branch_id,
    f.discount_type, f.discount_value, f.applies_to, category, medicineId,
    f.min_bill_amount, f.from_date, f.to_date, f.active, req.params.id);
  auditDiff(req, 'promotions', Number(req.params.id), before, f,
    ['name', 'branch_id', 'discount_type', 'discount_value', 'applies_to', 'category', 'medicine_id', 'min_bill_amount', 'from_date', 'to_date', 'active']);
  res.json({ ok: true });
}));

router.delete('/:id(\\d+)', requirePermission('discounts.manage'), wrap(async (req, res) => {
  const promo = await get('SELECT * FROM promotions WHERE id = ?', req.params.id);
  if (!promo) return res.status(404).json({ error: 'Offer not found' });
  const used = await get('SELECT 1 FROM sales WHERE promo_id = ? LIMIT 1', promo.id);
  if (used) {
    await run('UPDATE promotions SET active = 0 WHERE id = ?', promo.id);
    audit(req, 'deactivate', 'promotions', promo.id, `${promo.name} used on bills; deactivated instead of deleted`);
    return res.json({ ok: true, deactivated: true, message: 'Offer was used on bills, so it was deactivated instead of deleted.' });
  }
  await run('DELETE FROM promotions WHERE id = ?', promo.id);
  audit(req, 'delete', 'promotions', promo.id, promo.name);
  res.json({ ok: true });
}));

export default router;
