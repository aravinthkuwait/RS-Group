import { Router } from 'express';
import XLSX from 'xlsx';
import { all, get } from '../db.js';
import { requirePermission, scopeBranch } from '../auth.js';
import { round2, today } from '../util.js';
import { reportPdf } from '../pdf.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const NOT_VOID = "s.status NOT IN ('cancelled','held')";

function range(req) {
  const from = req.query.from || today().slice(0, 8) + '01';
  const to = req.query.to || today();
  return { from, to };
}

// ---------------- Owner / branch dashboard ----------------
router.get('/dashboard', requirePermission('dashboard.view'), wrap(async (req, res) => {
  const branchId = scopeBranch(req);
  const bw = branchId ? 'AND s.branch_id = ?' : '';
  const bp = branchId ? [branchId] : [];

  const salesAgg = (cond, params = []) => get(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(s.total),0) AS total,
       COALESCE(SUM(s.paid_cash),0) AS cash, COALESCE(SUM(s.paid_upi),0) AS upi,
       COALESCE(SUM(s.paid_card),0) AS card, COALESCE(SUM(s.credit_amount),0) AS credit,
       COALESCE(SUM((SELECT SUM((si.price - si.purchase_price) * (si.qty - si.returned_qty)) FROM sale_items si WHERE si.sale_id = s.id)),0) AS profit
     FROM sales s WHERE ${NOT_VOID} AND ${cond} ${bw}`, ...params, ...bp);

  const todaySales = await salesAgg('s.created_at::date = CURRENT_DATE');
  const monthSales = await salesAgg(`to_char(s.created_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')`);

  // 14-day sales trend
  const trend = await all(`SELECT s.created_at::date AS date, COALESCE(SUM(s.total),0) AS total, COUNT(*) AS bills
    FROM sales s WHERE ${NOT_VOID} AND s.created_at >= now() - interval '14 days' ${bw}
    GROUP BY s.created_at::date ORDER BY date`, ...bp);

  // Branch-wise (this month) — always returned; UI shows it for owner
  const branchWise = await all(`SELECT b.id, b.name, b.code, COALESCE(SUM(s.total),0) AS total, COUNT(s.id) AS bills
    FROM branches b LEFT JOIN sales s ON s.branch_id = b.id AND ${NOT_VOID} AND to_char(s.created_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')
    WHERE b.active = 1 GROUP BY b.id ORDER BY total DESC`);

  const bestSellers = await all(`SELECT m.name, SUM(si.qty)::int AS qty, ROUND(SUM(si.total)::numeric, 2) AS amount
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN medicines m ON m.id = si.medicine_id
    WHERE ${NOT_VOID} AND s.created_at >= now() - interval '30 days' ${bw}
    GROUP BY m.name ORDER BY qty DESC LIMIT 8`, ...bp);

  const staffPerf = await all(`SELECT u.name, COUNT(s.id) AS bills, ROUND(COALESCE(SUM(s.total),0)::numeric, 2) AS total
    FROM sales s JOIN users u ON u.id = s.staff_id
    WHERE ${NOT_VOID} AND to_char(s.created_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM') ${bw}
    GROUP BY u.name ORDER BY total DESC LIMIT 8`, ...bp);

  const sbw = branchId ? 'AND b.branch_id = ?' : '';
  const stockValue = await get(`SELECT ROUND(COALESCE(SUM(b.qty * b.purchase_price),0)::numeric, 2) AS cost,
      ROUND(COALESCE(SUM(b.qty * b.selling_price),0)::numeric, 2) AS retail
    FROM stock_batches b WHERE b.qty > 0 ${sbw}`, ...bp);
  const stockByBranch = await all(`SELECT br.name, br.code, ROUND(COALESCE(SUM(b.qty * b.purchase_price),0)::numeric, 2) AS value
    FROM branches br LEFT JOIN stock_batches b ON b.branch_id = br.id AND b.qty > 0
    WHERE br.active = 1 GROUP BY br.id`);

  const expiryRisk = await get(`SELECT COUNT(*) AS batches, ROUND(COALESCE(SUM(b.qty * b.purchase_price),0)::numeric, 2) AS value
    FROM stock_batches b WHERE b.qty > 0 AND b.expiry_date <= CURRENT_DATE + 90 ${sbw}`, ...bp);
  const expiredValue = await get(`SELECT COUNT(*) AS batches, ROUND(COALESCE(SUM(b.qty * b.purchase_price),0)::numeric, 2) AS value
    FROM stock_batches b WHERE b.qty > 0 AND b.expiry_date < CURRENT_DATE ${sbw}`, ...bp);

  const lowStockCount = (await get(`SELECT COUNT(*) AS c FROM (
    SELECT m.id FROM medicines m LEFT JOIN stock_batches b ON b.medicine_id = m.id ${branchId ? 'AND b.branch_id = ?' : ''}
    WHERE m.active = 1 GROUP BY m.id HAVING COALESCE(SUM(b.qty),0) <= MIN(m.min_stock)) t`, ...bp)).c;

  // Dues
  const supplierDues = (await get(`SELECT ROUND((COALESCE(SUM(sp.opening_balance),0) +
      COALESCE((SELECT SUM(total) FROM purchases WHERE status != 'returned'),0) -
      COALESCE((SELECT SUM(amount) FROM purchase_returns),0) -
      COALESCE((SELECT SUM(amount) FROM supplier_payments),0))::numeric, 2) AS due
    FROM suppliers sp WHERE sp.active = 1`)).due;
  const customerDues = (await get(`SELECT ROUND((
      COALESCE((SELECT SUM(credit_amount) FROM sales WHERE status != 'cancelled' ${branchId ? 'AND branch_id = ' + Number(branchId) : ''}),0) -
      COALESCE((SELECT SUM(CASE WHEN type='receipt' THEN amount ELSE -amount END) FROM payments WHERE sale_id IS NULL ${branchId ? 'AND branch_id = ' + Number(branchId) : ''}),0))::numeric, 2) AS due`)).due;

  const monthExpenses = (await get(`SELECT ROUND(COALESCE(SUM(amount),0)::numeric, 2) AS t FROM expenses
    WHERE to_char(date, 'YYYY-MM') = to_char(now(), 'YYYY-MM') ${branchId ? 'AND branch_id = ?' : ''}`, ...bp)).t;

  // Monthly sales for last 6 months (sales graph)
  const monthly = await all(`SELECT to_char(s.created_at, 'YYYY-MM') AS month, ROUND(SUM(s.total)::numeric, 2) AS total,
      ROUND(COALESCE(SUM((SELECT SUM((si.price - si.purchase_price) * (si.qty - si.returned_qty)) FROM sale_items si WHERE si.sale_id = s.id)),0)::numeric, 2) AS profit
    FROM sales s WHERE ${NOT_VOID} AND s.created_at >= now() - interval '6 months' ${bw}
    GROUP BY month ORDER BY month`, ...bp);

  res.json({
    today: todaySales, month: monthSales, trend, branch_wise: branchWise,
    best_sellers: bestSellers, staff_performance: staffPerf,
    stock_value: stockValue, stock_by_branch: stockByBranch,
    expiry_risk: expiryRisk, expired: expiredValue, low_stock_count: lowStockCount,
    supplier_dues: Math.max(0, supplierDues), customer_dues: Math.max(0, customerDues),
    month_expenses: monthExpenses,
    month_profit_net: round2((monthSales.profit || 0) - monthExpenses),
    monthly,
  });
}));

// ---------------- Report data builders ----------------
async function salesReport(req) {
  const branchId = scopeBranch(req); const { from, to } = range(req);
  const bw = branchId ? 'AND s.branch_id = ?' : ''; const bp = branchId ? [branchId] : [];
  const rows = await all(`SELECT s.invoice_no, s.created_at::date AS date, b.name AS branch, c.name AS customer,
      u.name AS staff, s.subtotal, s.discount, s.gst_amount AS gst, s.total,
      s.paid_cash AS cash, s.paid_upi AS upi, s.paid_card AS card, s.credit_amount AS credit, s.status
    FROM sales s JOIN branches b ON b.id = s.branch_id LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.staff_id
    WHERE s.status != 'held' AND s.created_at::date BETWEEN ? AND ? ${bw} ORDER BY s.created_at`, from, to, ...bp);
  return { rows, from, to };
}

async function stockReport(req) {
  const branchId = scopeBranch(req);
  const rows = await all(`SELECT m.name AS medicine, m.category, b.batch_no, br.code AS branch, b.expiry_date,
      b.qty, b.mrp, b.purchase_price, b.selling_price, ROUND((b.qty * b.purchase_price)::numeric, 2) AS stock_value, m.rack_location AS rack
    FROM stock_batches b JOIN medicines m ON m.id = b.medicine_id JOIN branches br ON br.id = b.branch_id
    WHERE b.qty > 0 ${branchId ? 'AND b.branch_id = ?' : ''} ORDER BY m.name`, ...(branchId ? [branchId] : []));
  return { rows };
}

async function gstReport(req) {
  const branchId = scopeBranch(req); const { from, to } = range(req);
  const bw = branchId ? 'AND s.branch_id = ?' : ''; const bp = branchId ? [branchId] : [];
  const rows = await all(`SELECT si.gst_rate, COUNT(DISTINCT s.id) AS bills, ROUND(SUM(si.total)::numeric, 2) AS gross,
      ROUND(SUM(si.gst_amount)::numeric, 2) AS gst, ROUND((SUM(si.total) - SUM(si.gst_amount))::numeric, 2) AS taxable
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE ${NOT_VOID} AND s.created_at::date BETWEEN ? AND ? ${bw}
    GROUP BY si.gst_rate ORDER BY si.gst_rate`, from, to, ...bp);
  return { rows, from, to };
}

async function purchaseReport(req) {
  const branchId = scopeBranch(req); const { from, to } = range(req);
  const rows = await all(`SELECT p.invoice_no, p.invoice_date AS date, b.code AS branch, sp.name AS supplier,
      p.subtotal, p.gst_amount AS gst, p.total, p.paid_amount AS paid, ROUND((p.total - p.paid_amount)::numeric, 2) AS pending, p.status
    FROM purchases p JOIN branches b ON b.id = p.branch_id JOIN suppliers sp ON sp.id = p.supplier_id
    WHERE p.invoice_date BETWEEN ? AND ? ${branchId ? 'AND p.branch_id = ?' : ''} ORDER BY p.invoice_date`,
    from, to, ...(branchId ? [branchId] : []));
  return { rows, from, to };
}

async function expiryReport(req) {
  const branchId = scopeBranch(req);
  const days = Number(req.query.days || 90);
  const rows = await all(`SELECT m.name AS medicine, b.batch_no, br.code AS branch, b.expiry_date,
      (b.expiry_date - CURRENT_DATE) AS days_left, b.qty,
      ROUND((b.qty * b.purchase_price)::numeric, 2) AS value
    FROM stock_batches b JOIN medicines m ON m.id = b.medicine_id JOIN branches br ON br.id = b.branch_id
    WHERE b.qty > 0 AND b.expiry_date <= CURRENT_DATE + (?::int) ${branchId ? 'AND b.branch_id = ?' : ''}
    ORDER BY b.expiry_date`, days, ...(branchId ? [branchId] : []));
  return { rows, days };
}

async function productSalesReport(req) {
  const branchId = scopeBranch(req); const { from, to } = range(req);
  const bw = branchId ? 'AND s.branch_id = ?' : ''; const bp = branchId ? [branchId] : [];
  const rows = await all(`SELECT m.name AS medicine, m.category, SUM(si.qty)::int AS qty, ROUND(SUM(si.total)::numeric, 2) AS amount,
      ROUND(SUM((si.price - si.purchase_price) * (si.qty - si.returned_qty))::numeric, 2) AS profit
    FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN medicines m ON m.id = si.medicine_id
    WHERE ${NOT_VOID} AND s.created_at::date BETWEEN ? AND ? ${bw}
    GROUP BY m.name, m.category ORDER BY amount DESC`, from, to, ...bp);
  return { rows, from, to };
}

async function staffSalesReport(req) {
  const branchId = scopeBranch(req); const { from, to } = range(req);
  const bw = branchId ? 'AND s.branch_id = ?' : ''; const bp = branchId ? [branchId] : [];
  const rows = await all(`SELECT u.name AS staff, b.code AS branch, COUNT(s.id) AS bills, ROUND(SUM(s.total)::numeric, 2) AS total,
      ROUND(AVG(s.total)::numeric, 2) AS avg_bill
    FROM sales s JOIN users u ON u.id = s.staff_id JOIN branches b ON b.id = s.branch_id
    WHERE ${NOT_VOID} AND s.created_at::date BETWEEN ? AND ? ${bw}
    GROUP BY u.name, b.code ORDER BY total DESC`, from, to, ...bp);
  return { rows, from, to };
}

async function profitReport(req) {
  const branchId = scopeBranch(req); const { from, to } = range(req);
  const bw = branchId ? 'AND s.branch_id = ?' : ''; const bp = branchId ? [branchId] : [];
  const sales = await get(`SELECT ROUND(COALESCE(SUM(s.total),0)::numeric, 2) AS revenue,
      ROUND(COALESCE(SUM((SELECT SUM(si.purchase_price
        * (si.qty - si.returned_qty)) FROM sale_items si WHERE si.sale_id = s.id)),0)::numeric, 2) AS cogs,
      ROUND(COALESCE(SUM(s.discount),0)::numeric, 2) AS discounts, ROUND(COALESCE(SUM(s.gst_amount),0)::numeric, 2) AS gst
    FROM sales s WHERE ${NOT_VOID} AND s.created_at::date BETWEEN ? AND ? ${bw}`, from, to, ...bp);
  const refunds = (await get(`SELECT ROUND(COALESCE(SUM(refund_amount),0)::numeric, 2) AS t FROM returns r
    WHERE r.created_at::date BETWEEN ? AND ? ${branchId ? 'AND r.branch_id = ?' : ''}`, from, to, ...bp)).t;
  const expenses = await all(`SELECT category, ROUND(SUM(amount)::numeric, 2) AS total FROM expenses
    WHERE date BETWEEN ? AND ? ${branchId ? 'AND branch_id = ?' : ''} GROUP BY category`, from, to, ...bp);
  const totalExpenses = round2(expenses.reduce((a, e) => a + e.total, 0));
  const grossProfit = round2(sales.revenue - refunds - sales.cogs);
  return {
    from, to, revenue: sales.revenue, refunds, cogs: sales.cogs, gst_collected: sales.gst,
    discounts: sales.discounts, gross_profit: grossProfit,
    expenses, total_expenses: totalExpenses, net_profit: round2(grossProfit - totalExpenses),
  };
}

// Discount report — group=bill|branch|user|customer|product.
// A bill's total discount = bill-level discount + item-level discounts.
const DISCOUNT_TOTAL = '(s.discount + COALESCE(s.item_discount, 0))';
async function discountsReport(req) {
  const branchId = scopeBranch(req); const { from, to } = range(req);
  const bw = branchId ? 'AND s.branch_id = ?' : ''; const bp = branchId ? [branchId] : [];
  const group = ['bill', 'branch', 'user', 'customer', 'product'].includes(req.query.group) ? req.query.group : 'bill';
  const base = `FROM sales s JOIN branches b ON b.id = s.branch_id
    LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.staff_id
    WHERE ${NOT_VOID} AND ${DISCOUNT_TOTAL} > 0 AND s.created_at::date BETWEEN ? AND ? ${bw}`;
  let rows;
  if (group === 'bill') {
    rows = await all(`SELECT s.invoice_no, s.created_at::date AS date, b.name AS branch, u.name AS staff,
        c.name AS customer, s.discount_type AS type,
        ROUND((s.subtotal + COALESCE(s.item_discount,0))::numeric, 2) AS gross,
        ROUND(${DISCOUNT_TOTAL}::numeric, 2) AS discount, s.total AS net, ap.name AS approved_by
      ${base.replace('WHERE', 'LEFT JOIN users ap ON ap.id = s.discount_approved_by WHERE')}
      ORDER BY s.created_at DESC`, from, to, ...bp);
  } else if (group === 'branch') {
    rows = await all(`SELECT b.name AS branch, COUNT(*) AS bills,
        ROUND(SUM(s.subtotal + COALESCE(s.item_discount,0))::numeric, 2) AS gross,
        ROUND(SUM(${DISCOUNT_TOTAL})::numeric, 2) AS discount,
        ROUND((SUM(${DISCOUNT_TOTAL}) * 100.0 / NULLIF(SUM(s.subtotal + COALESCE(s.item_discount,0)), 0))::numeric, 2) AS discount_pct
      ${base} GROUP BY b.name ORDER BY discount DESC`, from, to, ...bp);
  } else if (group === 'user') {
    rows = await all(`SELECT u.name AS staff, b.code AS branch, COUNT(*) AS bills,
        ROUND(SUM(${DISCOUNT_TOTAL})::numeric, 2) AS discount,
        ROUND((SUM(${DISCOUNT_TOTAL}) * 100.0 / NULLIF(SUM(s.subtotal + COALESCE(s.item_discount,0)), 0))::numeric, 2) AS discount_pct
      ${base} GROUP BY u.name, b.code ORDER BY discount DESC`, from, to, ...bp);
  } else if (group === 'customer') {
    rows = await all(`SELECT COALESCE(c.name, 'Walk-in') AS customer, c.phone, COUNT(*) AS bills,
        ROUND(SUM(${DISCOUNT_TOTAL})::numeric, 2) AS discount
      ${base} GROUP BY c.name, c.phone ORDER BY discount DESC`, from, to, ...bp);
  } else {
    // product: item discounts + each line's proportional share of the bill discount
    rows = await all(`SELECT m.name AS medicine, m.category, SUM(si.qty)::int AS qty,
        ROUND(SUM(si.total)::numeric, 2) AS sales,
        ROUND(SUM(si.discount + s.discount * si.total / NULLIF(s.subtotal, 0))::numeric, 2) AS discount
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      JOIN medicines m ON m.id = si.medicine_id JOIN branches b ON b.id = s.branch_id
      WHERE ${NOT_VOID} AND ${DISCOUNT_TOTAL} > 0 AND s.created_at::date BETWEEN ? AND ? ${bw}
      GROUP BY m.name, m.category HAVING SUM(si.discount + s.discount * si.total / NULLIF(s.subtotal, 0)) > 0.005
      ORDER BY discount DESC`, from, to, ...bp);
  }
  const totals = await get(`SELECT COUNT(*) AS bills, ROUND(COALESCE(SUM(${DISCOUNT_TOTAL}),0)::numeric, 2) AS discount,
      ROUND(COALESCE(SUM((SELECT SUM((si.price - si.purchase_price) * (si.qty - si.returned_qty)) FROM sale_items si WHERE si.sale_id = s.id) - ${DISCOUNT_TOTAL}),0)::numeric, 2) AS profit_after
    ${base}`, from, to, ...bp);
  return { rows, from, to, group, totals };
}

const DISCOUNT_COLUMNS = {
  bill: [
    { key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date' }, { key: 'branch', label: 'Branch' },
    { key: 'staff', label: 'Staff' }, { key: 'customer', label: 'Customer' }, { key: 'type', label: 'Type' },
    { key: 'gross', label: 'Gross', align: 'right' }, { key: 'discount', label: 'Discount', align: 'right' },
    { key: 'net', label: 'Net', align: 'right' }, { key: 'approved_by', label: 'Approved By' },
  ],
  branch: [
    { key: 'branch', label: 'Branch' }, { key: 'bills', label: 'Bills', align: 'right' },
    { key: 'gross', label: 'Gross Sales', align: 'right' }, { key: 'discount', label: 'Discount', align: 'right' },
    { key: 'discount_pct', label: 'Discount %', align: 'right' },
  ],
  user: [
    { key: 'staff', label: 'Staff' }, { key: 'branch', label: 'Branch' }, { key: 'bills', label: 'Bills', align: 'right' },
    { key: 'discount', label: 'Discount', align: 'right' }, { key: 'discount_pct', label: 'Discount %', align: 'right' },
  ],
  customer: [
    { key: 'customer', label: 'Customer' }, { key: 'phone', label: 'Phone' },
    { key: 'bills', label: 'Bills', align: 'right' }, { key: 'discount', label: 'Discount', align: 'right' },
  ],
  product: [
    { key: 'medicine', label: 'Medicine' }, { key: 'category', label: 'Category' },
    { key: 'qty', label: 'Qty Sold', align: 'right' }, { key: 'sales', label: 'Sales', align: 'right' },
    { key: 'discount', label: 'Discount', align: 'right' },
  ],
};

const REPORTS = {
  sales: {
    title: 'Sales Report', build: salesReport,
    columns: [
      { key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date' }, { key: 'branch', label: 'Branch' },
      { key: 'customer', label: 'Customer' }, { key: 'staff', label: 'Staff' },
      { key: 'total', label: 'Total', align: 'right' }, { key: 'cash', label: 'Cash', align: 'right' },
      { key: 'upi', label: 'UPI', align: 'right' }, { key: 'card', label: 'Card', align: 'right' },
      { key: 'credit', label: 'Credit', align: 'right' }, { key: 'status', label: 'Status' },
    ],
    summary: d => [['Total Bills', d.rows.length], ['Total Sales', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.total, 0)).toFixed(2)]],
  },
  stock: {
    title: 'Stock Report', build: stockReport,
    columns: [
      { key: 'medicine', label: 'Medicine' }, { key: 'category', label: 'Category' }, { key: 'branch', label: 'Branch' },
      { key: 'batch_no', label: 'Batch' }, { key: 'expiry_date', label: 'Expiry' }, { key: 'rack', label: 'Rack' },
      { key: 'qty', label: 'Qty', align: 'right' }, { key: 'mrp', label: 'MRP', align: 'right' },
      { key: 'stock_value', label: 'Value', align: 'right' },
    ],
    summary: d => [['Batches', d.rows.length], ['Stock Value (cost)', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.stock_value, 0)).toFixed(2)]],
  },
  expiry: {
    title: 'Expiry Report', build: expiryReport,
    columns: [
      { key: 'medicine', label: 'Medicine' }, { key: 'branch', label: 'Branch' }, { key: 'batch_no', label: 'Batch' },
      { key: 'expiry_date', label: 'Expiry' }, { key: 'days_left', label: 'Days Left', align: 'right' },
      { key: 'qty', label: 'Qty', align: 'right' }, { key: 'value', label: 'Value', align: 'right' },
    ],
    summary: d => [['Batches at risk', d.rows.length], ['Value at risk', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.value, 0)).toFixed(2)]],
  },
  purchases: {
    title: 'Purchase Report', build: purchaseReport,
    columns: [
      { key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date' }, { key: 'branch', label: 'Branch' },
      { key: 'supplier', label: 'Supplier' }, { key: 'total', label: 'Total', align: 'right' },
      { key: 'paid', label: 'Paid', align: 'right' }, { key: 'pending', label: 'Pending', align: 'right' }, { key: 'status', label: 'Status' },
    ],
    summary: d => [['Invoices', d.rows.length], ['Total Purchases', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.total, 0)).toFixed(2)],
      ['Pending to Suppliers', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.pending, 0)).toFixed(2)]],
  },
  gst: {
    title: 'GST Tax Report', build: gstReport,
    columns: [
      { key: 'gst_rate', label: 'GST %', align: 'right' }, { key: 'bills', label: 'Bills', align: 'right' },
      { key: 'taxable', label: 'Taxable Value', align: 'right' }, { key: 'gst', label: 'GST Amount', align: 'right' },
      { key: 'gross', label: 'Gross', align: 'right' },
    ],
    summary: d => [['Total GST Collected', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.gst, 0)).toFixed(2)]],
  },
  products: {
    title: 'Product Sales Report', build: productSalesReport,
    columns: [
      { key: 'medicine', label: 'Medicine' }, { key: 'category', label: 'Category' },
      { key: 'qty', label: 'Qty Sold', align: 'right' }, { key: 'amount', label: 'Sales', align: 'right' },
      { key: 'profit', label: 'Profit', align: 'right' },
    ],
    summary: d => [['Products', d.rows.length], ['Total', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.amount, 0)).toFixed(2)]],
  },
  staff: {
    title: 'Staff Sales Report', build: staffSalesReport,
    columns: [
      { key: 'staff', label: 'Staff' }, { key: 'branch', label: 'Branch' }, { key: 'bills', label: 'Bills', align: 'right' },
      { key: 'total', label: 'Sales', align: 'right' }, { key: 'avg_bill', label: 'Avg Bill', align: 'right' },
    ],
    summary: d => [['Total', 'Rs. ' + round2(d.rows.reduce((a, r) => a + r.total, 0)).toFixed(2)]],
  },
  discounts: {
    title: 'Discount Report', build: discountsReport,
    columns: req => DISCOUNT_COLUMNS[['bill', 'branch', 'user', 'customer', 'product'].includes(req.query.group) ? req.query.group : 'bill'],
    summary: d => [
      ['Bills with discount', d.totals.bills],
      ['Total discount given', 'Rs. ' + round2(d.totals.discount).toFixed(2)],
      ['Profit impact', '- Rs. ' + round2(d.totals.discount).toFixed(2)],
      ['Profit after discounts', 'Rs. ' + round2(d.totals.profit_after).toFixed(2)],
    ],
  },
};

const columnsFor = (r, req) => (typeof r.columns === 'function' ? r.columns(req) : r.columns);

router.get('/list', requirePermission('reports.view'), wrap(async (req, res) => {
  res.json({ reports: Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title })).concat([{ key: 'profit', title: 'Profit & Loss Report' }]) });
}));

router.get('/profit', requirePermission('reports.view'), wrap(async (req, res) => {
  res.json(await profitReport(req));
}));

router.get('/:key(sales|stock|expiry|purchases|gst|products|staff|discounts)', requirePermission('reports.view'), wrap(async (req, res) => {
  const r = REPORTS[req.params.key];
  const data = await r.build(req);
  res.json({ title: r.title, columns: r.columns, rows: data.rows, from: data.from, to: data.to, summary: r.summary(data) });
}));

router.get('/:key(sales|stock|expiry|purchases|gst|products|staff|discounts)/export', requirePermission('reports.export'), wrap(async (req, res) => {
  const r = REPORTS[req.params.key];
  const data = await r.build(req);
  const branchId = scopeBranch(req);
  const branchName = branchId ? (await get('SELECT name FROM branches WHERE id = ?', branchId))?.name : 'All Branches';
  const period = data.from ? `Period: ${data.from} to ${data.to}` : `As on ${today()}`;

  if (req.query.format === 'xlsx') {
    const header = r.columns.map(c => c.label);
    const body = data.rows.map(row => r.columns.map(c => row[c.key]));
    const summaryRows = r.summary(data).map(([k, v]) => [k, String(v)]);
    const ws = XLSX.utils.aoa_to_sheet([[r.title], [branchName + ' — ' + period], [], header, ...body, [], ...summaryRows]);
    ws['!cols'] = r.columns.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, r.title.slice(0, 30));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}-report.xlsx"`);
    return res.send(buf);
  }
  await reportPdf(res, { title: r.title, branchName, period, columns: r.columns, rows: data.rows, summary: r.summary(data), printedBy: req.user.name });
}));

export default router;
