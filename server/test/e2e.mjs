const B = 'http://localhost:4000/api';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name} ${extra}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
};
const req = async (path, method = 'GET', body, token) => {
  const r = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})), raw: r };
};

console.log('— Auth —');
const bad = await req('/auth/login', 'POST', { email: 'owner@rsgroup.in', password: 'wrong' });
ok('wrong password rejected', bad.status === 401);
const owner = (await req('/auth/login', 'POST', { email: 'owner@rsgroup.in', password: 'rsgroup123' })).data;
ok('owner login', !!owner.token, owner.user?.role);
const staffLogin = (await req('/auth/login', 'POST', { email: 'suresh@rsgroup.in', password: 'rsgroup123', branch_code: 'RSG-CHN' })).data;
ok('billing staff branch login', !!staffLogin.token);
const wrongBranch = await req('/auth/login', 'POST', { email: 'suresh@rsgroup.in', password: 'rsgroup123', branch_code: 'RSG-MDU' });
ok('wrong branch code rejected', wrongBranch.status === 401);
const T = staffLogin.token, OT = owner.token;

const fp = (await req('/auth/forgot-password', 'POST', { email: 'divya@rsgroup.in' })).data;
ok('forgot password gives code', !!fp.demo_reset_code);
const rp = await req('/auth/reset-password', 'POST', { email: 'divya@rsgroup.in', code: fp.demo_reset_code, new_password: 'newpass123' });
ok('reset password works', rp.status === 200);
const relog = await req('/auth/login', 'POST', { email: 'divya@rsgroup.in', password: 'newpass123' });
ok('login with new password', relog.status === 200);

console.log('— Permissions —');
const denied = await req('/admin/branches', 'POST', { code: 'X', name: 'X' }, T);
ok('billing staff cannot create branch', denied.status === 403);
const audT = (await req('/auth/login', 'POST', { email: 'auditor@rsgroup.in', password: 'rsgroup123' })).data.token;
const audWrite = await req('/sales', 'POST', { items: [] }, audT);
ok('auditor cannot bill', audWrite.status === 403);
const audRead = await req('/reports/dashboard', 'GET', null, audT);
ok('auditor can view dashboard', audRead.status === 200);

console.log('— POS billing flow —');
const search = (await req('/inventory/medicines/pos-search?q=crocin', 'GET', null, T)).data;
ok('POS search finds medicine', search.results.length > 0, `(${search.results.length} results)`);
const item = search.results[0];
const search2 = (await req('/inventory/medicines/pos-search?q=shelcal', 'GET', null, T)).data;
const item2 = search2.results[0];
ok('second item found', !!item2);

// Held bill then resume
const hold = (await req('/sales', 'POST', {
  items: [{ batch_id: item.batch_id, qty: 2 }], hold: true, customer_phone: '+91 9998887771', customer_name: 'Test Kumar',
}, T)).data;
ok('hold bill', !!hold.id, hold.invoice_no);
const heldList = (await req('/sales/held', 'GET', null, T)).data;
ok('held list contains bill', heldList.sales.some(s => s.id === hold.id));

const discDenied = await req('/sales', 'POST', {
  items: [{ batch_id: item.batch_id, qty: 1 }], discount: 5,
  payment: { cash: 1, upi: 0, card: 0, credit: 0 },
}, T);
ok('discount without permission rejected', discDenied.status === 403);
const bill = (await req('/sales', 'POST', {
  items: [{ batch_id: item.batch_id, qty: 2 }, { batch_id: item2.batch_id, qty: 1 }],
  customer_phone: '+91 9998887771',
  payment: { cash: 0, upi: 0, card: 0, credit: 0 },
}, T));
ok('bill with wrong payment rejected', bill.status === 400);

const qtyBefore = item.qty;
const total = Math.round(2 * item.selling_price + 1 * item2.selling_price);
const sale = (await req('/sales', 'POST', {
  items: [{ batch_id: item.batch_id, qty: 2 }, { batch_id: item2.batch_id, qty: 1 }],
  customer_phone: '+91 9998887771', customer_name: 'Test Kumar', doctor_name: 'Dr. Test',
  payment: { cash: total, upi: 0, card: 0, credit: 0 },
  resume_sale_id: hold.id,
}, T)).data;
ok('bill created', !!sale.id, `${sale.invoice_no} ₹${sale.total}`);
ok('total computed correctly', sale.total === total, `expected ${total} got ${sale.total}`);
const after = (await req(`/inventory/medicines/pos-search?q=${encodeURIComponent(item.name.split(' ')[0])}`, 'GET', null, T)).data;
const batchAfter = after.results.find(r => r.batch_id === item.batch_id);
ok('stock deducted', batchAfter && batchAfter.qty === qtyBefore - 2, `${qtyBefore} → ${batchAfter?.qty}`);

const pdf = await fetch(`${B}/sales/${sale.id}/pdf?token=${T}`);
ok('invoice PDF', pdf.status === 200 && pdf.headers.get('content-type').includes('pdf'), `${(await pdf.arrayBuffer()).byteLength} bytes`);
const wa = (await req(`/sales/${sale.id}/whatsapp`, 'GET', null, T)).data;
ok('whatsapp share link', wa.url?.startsWith('https://wa.me/'));

console.log('— Returns —');
const saleDetail = (await req(`/sales/${sale.id}`, 'GET', null, T)).data.sale;
const ret = (await req(`/sales/${sale.id}/returns`, 'POST', {
  items: [{ sale_item_id: saleDetail.items[0].id, qty: 1 }], reason: 'test return', refund_method: 'cash',
}, T)).data;
ok('return created', !!ret.id, `refund ₹${ret.refund_amount}`);
const afterRet = (await req(`/inventory/medicines/pos-search?q=${encodeURIComponent(item.name.split(' ')[0])}`, 'GET', null, T)).data;
ok('stock restored after return', afterRet.results.find(r => r.batch_id === item.batch_id)?.qty === qtyBefore - 1);

console.log('— Credit + customer flow —');
const credit = (await req('/sales', 'POST', {
  items: [{ batch_id: item2.batch_id, qty: 1 }], customer_phone: '+91 9998887771',
  payment: { cash: 0, upi: 0, card: 0, credit: Math.round(item2.selling_price) },
}, T)).data;
ok('credit sale', !!credit.id);
const dues = (await req('/customers/dues/list', 'GET', null, T)).data;
const cust = dues.dues.find(c => c.phone === '+91 9998887771');
ok('customer credit due tracked', cust && cust.credit_balance > 0, `₹${cust?.credit_balance}`);
const pay = (await req(`/customers/${cust.id}/payments`, 'POST', { amount: cust.credit_balance, method: 'cash' }, T)).data;
ok('credit payment clears balance', pay.credit_balance === 0);

console.log('— Purchase flow (owner) —');
const meds = (await req('/inventory/medicines?q=dolo', 'GET', null, OT)).data.medicines;
const purchase = (await req('/purchases', 'POST', {
  branch_id: 1, supplier_id: 1, invoice_no: 'TEST-INV-1', invoice_date: new Date().toISOString().slice(0,10),
  items: [{ medicine_id: meds[0].id, batch_no: 'TESTB1', expiry_date: '2028-01-01', qty: 50, purchase_price: 20, mrp: 33.6, selling_price: 32 }],
  paid_amount: 500,
}, OT)).data;
ok('purchase entry', !!purchase.id, `total ₹${purchase.total}`);
const ledger = (await req('/purchases/suppliers/1/ledger', 'GET', null, OT)).data;
ok('supplier ledger has entries', ledger.ledger.length > 0, `balance ₹${ledger.balance}`);

console.log('— Stock transfer —');
const stock = (await req('/inventory/stock?q=TESTB1', 'GET', null, OT)).data.stock;
const tr = (await req('/inventory/transfers', 'POST', {
  from_branch_id: 1, to_branch_id: 2, items: [{ batch_id: stock[0].id, qty: 10 }], notes: 'e2e test',
}, OT)).data;
ok('transfer created', !!tr.id);
const rcv = await req(`/inventory/transfers/${tr.id}/receive`, 'POST', {}, OT);
ok('transfer received', rcv.status === 200);
const stockAt2 = (await req('/inventory/stock?q=TESTB1&branch_id=2', 'GET', null, OT)).data.stock;
ok('stock arrived at destination', stockAt2.some(s => s.branch_id === 2 && s.qty === 10));

console.log('— Adjustments —');
const adj = await req('/inventory/adjustments', 'POST', { batch_id: stock[0].id, qty_change: -2, type: 'damage', reason: 'broken strips' }, OT);
ok('damage adjustment', adj.status === 200);

console.log('— Accounts —');
const exp = (await req('/accounts/expenses', 'POST', { branch_id: 1, category: 'Transport', amount: 150, paid_method: 'cash' }, OT)).data;
ok('expense added', !!exp.id);
const cc = (await req('/accounts/cash-closing?branch_id=1', 'GET', null, OT)).data;
ok('cash closing computed', typeof cc.expected_cash === 'number', `expected ₹${cc.expected_cash}`);
const ccSave = (await req('/accounts/cash-closing', 'POST', { branch_id: 1, actual_cash: cc.expected_cash, cash_deposited: 1000 }, OT)).data;
ok('cash closing saved', ccSave.ok && ccSave.difference === 0);

console.log('— Reports & exports —');
for (const k of ['sales', 'stock', 'expiry', 'purchases', 'gst', 'products', 'staff']) {
  const r = (await req(`/reports/${k}?from=2000-01-01&to=2099-12-31`, 'GET', null, OT)).data;
  ok(`report: ${k}`, Array.isArray(r.rows), `${r.rows?.length} rows`);
}
const xlsx = await fetch(`${B}/reports/sales/export?format=xlsx&from=2000-01-01&to=2099-12-31&token=${OT}`);
ok('Excel export', xlsx.status === 200 && (xlsx.headers.get('content-type') || '').includes('spreadsheet'), `${(await xlsx.arrayBuffer()).byteLength} bytes`);
const rpdf = await fetch(`${B}/reports/expiry/export?token=${OT}`);
ok('Report PDF export', rpdf.status === 200 && (rpdf.headers.get('content-type') || '').includes('pdf'));
const profit = (await req('/reports/profit?from=2000-01-01&to=2099-12-31', 'GET', null, OT)).data;
ok('profit report', typeof profit.net_profit === 'number', `net ₹${profit.net_profit}`);

console.log('— Staff features —');
const ci = await req('/staff/attendance/check-in', 'POST', {}, T);
ok('attendance check-in', ci.status === 200);
const co = await req('/staff/attendance/check-out', 'POST', {}, T);
ok('attendance check-out', co.status === 200);
const task = (await req('/staff/tasks', 'POST', { title: 'E2E test task', assigned_to: staffLogin.user.id }, OT)).data;
ok('task created', !!task.id);
const tdone = await req(`/staff/tasks/${task.id}`, 'PUT', { status: 'done' }, T);
ok('staff completes own task', tdone.status === 200);
const notifs = (await req('/staff/notifications', 'GET', null, T)).data;
ok('notifications delivered', notifs.notifications.length > 0, `${notifs.notifications.length}`);

console.log('— Admin —');
const nu = (await req('/admin/users', 'POST', { name: 'Temp User', email: 'temp@rsgroup.in', password: 'temp123', role: 'billing_staff', branch_id: 1 }, OT)).data;
ok('user created', !!nu.id);
const disabled = await req(`/admin/users/${nu.id}`, 'PUT', { active: 0 }, OT);
ok('user disabled', disabled.status === 200);
const dlogin = await req('/auth/login', 'POST', { email: 'temp@rsgroup.in', password: 'temp123' });
ok('disabled user cannot login', dlogin.status === 401);
const permUpdate = await req('/admin/permissions/billing_staff', 'PUT', { permissions: ['billing.create', 'billing.view', 'inventory.view', 'customers.view', 'customers.manage', 'dashboard.view', 'billing.return', 'tasks.view', 'attendance.self'] }, OT);
ok('role permissions editable', permUpdate.status === 200);
const logs = (await req('/admin/audit-logs', 'GET', null, OT)).data;
ok('audit log populated', logs.logs.length > 10, `${logs.logs.length} entries`);
const lh = (await req('/auth/login-history', 'GET', null, OT)).data;
ok('login history', lh.history.length > 0, `${lh.history.length} entries`);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
