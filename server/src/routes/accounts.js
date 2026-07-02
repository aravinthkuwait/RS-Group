import { Router } from 'express';
import db from '../db.js';
import { requirePermission, scopeBranch, writeBranch } from '../auth.js';
import { audit, notify, round2, today } from '../util.js';

const router = Router();

// ---------------- Expenses ----------------
router.get('/expenses', requirePermission('expenses.view'), (req, res) => {
  const branchId = scopeBranch(req);
  const { from, to, category } = req.query;
  const where = ['1=1']; const params = [];
  if (branchId) { where.push('e.branch_id = ?'); params.push(branchId); }
  if (from) { where.push('e.date >= ?'); params.push(from); }
  if (to) { where.push('e.date <= ?'); params.push(to); }
  if (category) { where.push('e.category = ?'); params.push(category); }
  const rows = db.prepare(`SELECT e.*, b.name AS branch_name, u.name AS created_by_name
    FROM expenses e JOIN branches b ON b.id = e.branch_id LEFT JOIN users u ON u.id = e.created_by
    WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 300`).all(...params);
  const byCategory = db.prepare(`SELECT category, SUM(amount) AS total FROM expenses e
    WHERE ${where.join(' AND ')} GROUP BY category ORDER BY total DESC`).all(...params);
  res.json({ expenses: rows, by_category: byCategory, total: round2(rows.reduce((a, e) => a + e.amount, 0)) });
});

router.post('/expenses', requirePermission('expenses.manage'), (req, res) => {
  const { category, amount, date = today(), paid_method = 'cash', notes = '' } = req.body || {};
  if (!category || !amount || amount <= 0) return res.status(400).json({ error: 'Category and a valid amount are required' });
  const branchId = writeBranch(req, req.body.branch_id);
  const info = db.prepare(`INSERT INTO expenses (branch_id, category, amount, date, paid_method, notes, created_by)
    VALUES (?,?,?,?,?,?,?)`).run(branchId, category, amount, date, paid_method, notes, req.user.id);
  audit(req, 'create', 'expenses', info.lastInsertRowid, `${category} ₹${amount}`);
  res.json({ id: info.lastInsertRowid });
});

router.delete('/expenses/:id', requirePermission('expenses.manage'), (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (req.user.role !== 'super_admin' && e.branch_id !== req.user.branch_id) return res.status(403).json({ error: 'Expense belongs to another branch' });
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'expenses', Number(req.params.id), `${e.category} ₹${e.amount}`);
  res.json({ ok: true });
});

// ---------------- Daily cash closing ----------------
// Computes the day position for a branch: opening + cash sales + credit receipts (cash) - cash expenses - deposits
router.get('/cash-closing', requirePermission('accounts.manage'), (req, res) => {
  const branchId = scopeBranch(req) || req.user.branch_id;
  const date = req.query.date || today();
  if (!branchId) return res.status(400).json({ error: 'Select a branch' });

  const prev = db.prepare(`SELECT * FROM cash_closings WHERE branch_id = ? AND date < ? ORDER BY date DESC LIMIT 1`).get(branchId, date);
  const opening = prev ? round2(prev.actual_cash - prev.cash_deposited) : 0;
  const cashSales = db.prepare(`SELECT COALESCE(SUM(paid_cash),0) t FROM sales
    WHERE branch_id = ? AND date(created_at) = ? AND status NOT IN ('cancelled','held')`).get(branchId, date).t;
  const cashReceipts = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM payments
    WHERE branch_id = ? AND date = ? AND method = 'cash' AND type = 'receipt'`).get(branchId, date).t;
  const cashRefunds = db.prepare(`SELECT COALESCE(SUM(refund_amount),0) t FROM returns
    WHERE branch_id = ? AND date(created_at) = ? AND refund_method = 'cash'`).get(branchId, date).t;
  const cashExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses
    WHERE branch_id = ? AND date = ? AND paid_method = 'cash'`).get(branchId, date).t;
  const cashSupplierPayments = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM supplier_payments
    WHERE branch_id = ? AND date = ? AND method = 'cash'`).get(branchId, date).t;
  const upiCollections = db.prepare(`SELECT COALESCE(SUM(paid_upi),0) t FROM sales
    WHERE branch_id = ? AND date(created_at) = ? AND status NOT IN ('cancelled','held')`).get(branchId, date).t;
  const cardCollections = db.prepare(`SELECT COALESCE(SUM(paid_card),0) t FROM sales
    WHERE branch_id = ? AND date(created_at) = ? AND status NOT IN ('cancelled','held')`).get(branchId, date).t;

  const expected = round2(opening + cashSales + cashReceipts - cashRefunds - cashExpenses - cashSupplierPayments);
  const existing = db.prepare('SELECT * FROM cash_closings WHERE branch_id = ? AND date = ?').get(branchId, date);
  res.json({
    date, branch_id: branchId, opening_balance: opening,
    cash_sales: cashSales, cash_receipts: cashReceipts, cash_refunds: cashRefunds,
    cash_expenses: round2(cashExpenses + cashSupplierPayments),
    upi_collections: upiCollections, card_collections: cardCollections,
    expected_cash: expected, closing: existing || null,
  });
});

router.post('/cash-closing', requirePermission('accounts.manage'), (req, res) => {
  const { date = today(), actual_cash, cash_deposited = 0, notes = '' } = req.body || {};
  const branchId = writeBranch(req, req.body.branch_id);
  if (actual_cash == null) return res.status(400).json({ error: 'Enter the counted cash amount' });
  // Recompute expected server-side
  req.query = { date, branch_id: branchId };
  const prev = db.prepare(`SELECT * FROM cash_closings WHERE branch_id = ? AND date < ? ORDER BY date DESC LIMIT 1`).get(branchId, date);
  const opening = prev ? round2(prev.actual_cash - prev.cash_deposited) : 0;
  const cashSales = db.prepare(`SELECT COALESCE(SUM(paid_cash),0) t FROM sales WHERE branch_id = ? AND date(created_at) = ? AND status NOT IN ('cancelled','held')`).get(branchId, date).t;
  const cashReceipts = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM payments WHERE branch_id = ? AND date = ? AND method = 'cash' AND type = 'receipt'`).get(branchId, date).t;
  const cashRefunds = db.prepare(`SELECT COALESCE(SUM(refund_amount),0) t FROM returns WHERE branch_id = ? AND date(created_at) = ? AND refund_method = 'cash'`).get(branchId, date).t;
  const cashExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE branch_id = ? AND date = ? AND paid_method = 'cash'`).get(branchId, date).t;
  const cashSupplier = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM supplier_payments WHERE branch_id = ? AND date = ? AND method = 'cash'`).get(branchId, date).t;
  const expected = round2(opening + cashSales + cashReceipts - cashRefunds - cashExpenses - cashSupplier);
  const difference = round2(Number(actual_cash) - expected);

  db.prepare(`INSERT INTO cash_closings (branch_id, date, opening_balance, cash_sales, cash_expenses, cash_deposited, expected_cash, actual_cash, difference, notes, closed_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(branch_id, date) DO UPDATE SET opening_balance=excluded.opening_balance, cash_sales=excluded.cash_sales,
      cash_expenses=excluded.cash_expenses, cash_deposited=excluded.cash_deposited, expected_cash=excluded.expected_cash,
      actual_cash=excluded.actual_cash, difference=excluded.difference, notes=excluded.notes, closed_by=excluded.closed_by`)
    .run(branchId, date, opening, cashSales, round2(cashExpenses + cashSupplier), cash_deposited, expected, actual_cash, difference, notes, req.user.id);
  audit(req, 'cash_closing', 'cash_closings', null, `${date} expected ₹${expected} actual ₹${actual_cash}`);
  if (Math.abs(difference) > 100) {
    notify({ branch_id: branchId, role: 'branch_admin', type: 'accounts', title: 'Cash closing difference', message: `Cash difference of ₹${difference} on ${date}. Please verify.` });
  }
  res.json({ ok: true, expected_cash: expected, difference });
});

router.get('/cash-closing/history', requirePermission('accounts.manage'), (req, res) => {
  const branchId = scopeBranch(req);
  const rows = db.prepare(`SELECT cc.*, b.name AS branch_name, u.name AS closed_by_name
    FROM cash_closings cc JOIN branches b ON b.id = cc.branch_id LEFT JOIN users u ON u.id = cc.closed_by
    ${branchId ? 'WHERE cc.branch_id = ?' : ''} ORDER BY cc.date DESC LIMIT 60`)
    .all(...(branchId ? [branchId] : []));
  res.json({ closings: rows });
});

// UPI reconciliation: day-wise UPI totals vs recorded reference
router.get('/upi-reconciliation', requirePermission('accounts.manage'), (req, res) => {
  const branchId = scopeBranch(req);
  const rows = db.prepare(`SELECT date(created_at) AS date, COUNT(*) AS bills, SUM(paid_upi) AS upi_total
    FROM sales WHERE paid_upi > 0 AND status NOT IN ('cancelled','held') ${branchId ? 'AND branch_id = ?' : ''}
    GROUP BY date(created_at) ORDER BY date DESC LIMIT 30`).all(...(branchId ? [branchId] : []));
  res.json({ days: rows });
});

export default router;
