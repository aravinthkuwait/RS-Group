import { Router } from 'express';
import { all, get, run, insert } from '../db.js';
import { requirePermission, scopeBranch, writeBranch, canAccessBranch } from '../auth.js';
import { audit, notify, round2, today } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Expenses ----------------
router.get('/expenses', requirePermission('expenses.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const { from, to, category } = req.query;
  const where = ['1=1']; const params = [];
  if (branchId) { where.push('e.branch_id = ?'); params.push(branchId); }
  if (from) { where.push('e.date >= ?'); params.push(from); }
  if (to) { where.push('e.date <= ?'); params.push(to); }
  if (category) { where.push('e.category = ?'); params.push(category); }
  const rows = await all(`SELECT e.*, b.name AS branch_name, u.name AS created_by_name
    FROM expenses e JOIN branches b ON b.id = e.branch_id LEFT JOIN users u ON u.id = e.created_by
    WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 300`, ...params);
  const byCategory = await all(`SELECT category, SUM(amount) AS total FROM expenses e
    WHERE ${where.join(' AND ')} GROUP BY category ORDER BY total DESC`, ...params);
  res.json({ expenses: rows, by_category: byCategory, total: round2(rows.reduce((a, e) => a + e.amount, 0)) });
}));

router.post('/expenses', requirePermission('expenses.manage'), wrap(async (req, res) => {
  const { category, amount, date = today(), paid_method = 'cash', notes = '' } = req.body || {};
  if (!category || !amount || amount <= 0) return res.status(400).json({ error: 'Category and a valid amount are required' });
  const branchId = writeBranch(req, req.body.branch_id);
  const id = await insert(`INSERT INTO expenses (branch_id, category, amount, date, paid_method, notes, created_by)
    VALUES (?,?,?,?,?,?,?)`, branchId, category, amount, date, paid_method, notes, req.user.id);
  audit(req, 'create', 'expenses', id, `${category} ₹${amount}`);
  res.json({ id });
}));

router.delete('/expenses/:id', requirePermission('expenses.manage'), wrap(async (req, res) => {
  const e = await get('SELECT * FROM expenses WHERE id = ?', req.params.id);
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (!canAccessBranch(req.user, e.branch_id)) return res.status(403).json({ error: 'Expense belongs to another branch' });
  await run('DELETE FROM expenses WHERE id = ?', req.params.id);
  audit(req, 'delete', 'expenses', Number(req.params.id), `${e.category} ₹${e.amount}`);
  res.json({ ok: true });
}));

// ---------------- Daily cash closing ----------------
async function computeDayPosition(branchId, date) {
  const prev = await get('SELECT * FROM cash_closings WHERE branch_id = ? AND date < ? ORDER BY date DESC LIMIT 1', branchId, date);
  const opening = prev ? round2(prev.actual_cash - prev.cash_deposited) : 0;
  const cashSales = (await get(`SELECT COALESCE(SUM(paid_cash),0) AS t FROM sales
    WHERE branch_id = ? AND created_at::date = ? AND status NOT IN ('cancelled','held')`, branchId, date)).t;
  const cashReceipts = (await get(`SELECT COALESCE(SUM(amount),0) AS t FROM payments
    WHERE branch_id = ? AND date = ? AND method = 'cash' AND type = 'receipt'`, branchId, date)).t;
  const cashRefunds = (await get(`SELECT COALESCE(SUM(refund_amount),0) AS t FROM returns
    WHERE branch_id = ? AND created_at::date = ? AND refund_method = 'cash'`, branchId, date)).t;
  const cashExpenses = (await get(`SELECT COALESCE(SUM(amount),0) AS t FROM expenses
    WHERE branch_id = ? AND date = ? AND paid_method = 'cash'`, branchId, date)).t;
  const cashSupplier = (await get(`SELECT COALESCE(SUM(amount),0) AS t FROM supplier_payments
    WHERE branch_id = ? AND date = ? AND method = 'cash'`, branchId, date)).t;
  const expected = round2(opening + cashSales + cashReceipts - cashRefunds - cashExpenses - cashSupplier);
  return { opening, cashSales, cashReceipts, cashRefunds, cashExpenses, cashSupplier, expected };
}

router.get('/cash-closing', requirePermission('accounts.manage'), wrap(async (req, res) => {
  const branchId = scopeBranch(req) || req.user.branch_id;
  const date = req.query.date || today();
  if (!branchId) return res.status(400).json({ error: 'Select a branch' });

  const pos = await computeDayPosition(branchId, date);
  const upi = (await get(`SELECT COALESCE(SUM(paid_upi),0) AS t FROM sales
    WHERE branch_id = ? AND created_at::date = ? AND status NOT IN ('cancelled','held')`, branchId, date)).t;
  const card = (await get(`SELECT COALESCE(SUM(paid_card),0) AS t FROM sales
    WHERE branch_id = ? AND created_at::date = ? AND status NOT IN ('cancelled','held')`, branchId, date)).t;
  const existing = await get('SELECT * FROM cash_closings WHERE branch_id = ? AND date = ?', branchId, date);
  res.json({
    date, branch_id: branchId, opening_balance: pos.opening,
    cash_sales: pos.cashSales, cash_receipts: pos.cashReceipts, cash_refunds: pos.cashRefunds,
    cash_expenses: round2(pos.cashExpenses + pos.cashSupplier),
    upi_collections: upi, card_collections: card,
    expected_cash: pos.expected, closing: existing || null,
  });
}));

router.post('/cash-closing', requirePermission('accounts.manage'), wrap(async (req, res) => {
  const { date = today(), actual_cash, cash_deposited = 0, notes = '' } = req.body || {};
  const branchId = writeBranch(req, req.body.branch_id);
  if (actual_cash == null) return res.status(400).json({ error: 'Enter the counted cash amount' });
  const pos = await computeDayPosition(branchId, date);
  const difference = round2(Number(actual_cash) - pos.expected);

  await run(`INSERT INTO cash_closings (branch_id, date, opening_balance, cash_sales, cash_expenses, cash_deposited, expected_cash, actual_cash, difference, notes, closed_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (branch_id, date) DO UPDATE SET opening_balance=excluded.opening_balance, cash_sales=excluded.cash_sales,
      cash_expenses=excluded.cash_expenses, cash_deposited=excluded.cash_deposited, expected_cash=excluded.expected_cash,
      actual_cash=excluded.actual_cash, difference=excluded.difference, notes=excluded.notes, closed_by=excluded.closed_by`,
    branchId, date, pos.opening, pos.cashSales, round2(pos.cashExpenses + pos.cashSupplier), cash_deposited, pos.expected, actual_cash, difference, notes, req.user.id);
  audit(req, 'cash_closing', 'cash_closings', null, `${date} expected ₹${pos.expected} actual ₹${actual_cash}`);
  if (Math.abs(difference) > 100) {
    await notify({ branch_id: branchId, role: 'branch_admin', type: 'accounts', title: 'Cash closing difference', message: `Cash difference of ₹${difference} on ${date}. Please verify.` });
  }
  res.json({ ok: true, expected_cash: pos.expected, difference });
}));

router.get('/cash-closing/history', requirePermission('accounts.manage'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const rows = await all(`SELECT cc.*, b.name AS branch_name, u.name AS closed_by_name
    FROM cash_closings cc JOIN branches b ON b.id = cc.branch_id LEFT JOIN users u ON u.id = cc.closed_by
    ${branchId ? 'WHERE cc.branch_id = ?' : ''} ORDER BY cc.date DESC LIMIT 60`,
    ...(branchId ? [branchId] : []));
  res.json({ closings: rows });
}));

// UPI reconciliation: day-wise UPI totals
router.get('/upi-reconciliation', requirePermission('accounts.manage'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const rows = await all(`SELECT created_at::date AS date, COUNT(*) AS bills, SUM(paid_upi) AS upi_total
    FROM sales WHERE paid_upi > 0 AND status NOT IN ('cancelled','held') ${branchId ? 'AND branch_id = ?' : ''}
    GROUP BY created_at::date ORDER BY date DESC LIMIT 30`, ...(branchId ? [branchId] : []));
  res.json({ days: rows });
}));

export default router;
