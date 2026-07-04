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
  items: [{ batch_id: item.batch_id, qty: 1 }], discount: { type: 'percent', value: 50 },
  payment: { cash: Math.round(item.selling_price / 2), upi: 0, card: 0, credit: 0 },
}, T);
ok('over-limit discount needs approval', discDenied.status === 403 && discDenied.data.approval_required === true);
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

console.log('— Purchase v4: new medicine, MM/YYYY, strip count, brand/generic —');
const brandsBefore = (await req('/inventory/brands', 'GET', null, OT)).data.brands.length;
const genUniq = 'E2EGen' + purchase.id;
const p4 = (await req('/purchases', 'POST', {
  branch_id: 1, supplier_id: 2, invoice_no: 'V4-INV-' + purchase.id, invoice_date: new Date().toISOString().slice(0,10),
  items: [{
    medicine_name: 'E2E New Med ' + purchase.id, brand: 'E2E Brand ' + purchase.id, generic_name: genUniq, strip_count: 15,
    batch_no: 'V4BATCH', expiry_date: '08/2029', qty: 20, purchase_price: 10, mrp: 18, selling_price: 16,
  }],
}, OT)).data;
ok('purchase creates a new medicine', !!p4.id, p4.error || '');
const brandsAfter = (await req('/inventory/brands', 'GET', null, OT)).data.brands.length;
ok('new brand added to master', brandsAfter > brandsBefore);
const gens = (await req(`/inventory/generics?q=${genUniq}`, 'GET', null, OT)).data.generics;
ok('new generic added to master', gens.some(g => g.name === genUniq));
const v4stock = (await req('/inventory/stock?q=V4BATCH&branch_id=1', 'GET', null, OT)).data.stock;
ok('MM/YYYY expiry normalised to month end', v4stock[0]?.expiry_date === '2029-08-31', v4stock[0]?.expiry_date);
ok('strip count stored on new medicine', v4stock[0]?.strip_count === 15, `strip ${v4stock[0]?.strip_count}`);
// Search stock by brand and generic
ok('stock search by brand', (await req(`/inventory/stock?q=E2E Brand ${purchase.id}`, 'GET', null, OT)).data.stock.length > 0);
ok('stock search by generic', (await req(`/inventory/stock?q=${genUniq}`, 'GET', null, OT)).data.stock.length > 0);
// Edit + delete purchase (deletes reverse stock)
const p4edit = await req(`/purchases/${p4.id}`, 'PUT', { notes: 'edited by e2e' }, OT);
ok('purchase header editable', p4edit.status === 200);
const p4del = await req(`/purchases/${p4.id}`, 'DELETE', null, OT);
ok('purchase delete reverses stock', p4del.status === 200);
ok('deleted purchase stock removed', (await req('/inventory/stock?q=V4BATCH&branch_id=1', 'GET', null, OT)).data.stock.length === 0);
// Delete refused when stock already sold
const soldMed = (await req('/inventory/medicines/pos-search?q=dolo&branch_id=1', 'GET', null, OT)).data.results[0];
const guardPur = (await req('/purchases', 'POST', {
  branch_id: 1, supplier_id: 1, invoice_no: 'GUARD-' + purchase.id, invoice_date: new Date().toISOString().slice(0,10),
  items: [{ medicine_id: soldMed.id, batch_no: 'GUARDB', expiry_date: '10/2029', qty: 5, purchase_price: 20, mrp: 33, selling_price: 30 }],
}, OT)).data;
const gStock = (await req('/inventory/stock?q=GUARDB&branch_id=1', 'GET', null, OT)).data.stock[0];
await req('/sales', 'POST', { branch_id: 1, items: [{ batch_id: gStock.id, qty: 2 }], payment: { cash: 60, upi: 0, card: 0, credit: 0 } }, OT);
const guardDel = await req(`/purchases/${guardPur.id}`, 'DELETE', null, OT);
ok('delete refused after stock sold', guardDel.status === 400);

console.log('— Purchase v4: reports & dashboard widgets —');
for (const k of ['brands', 'generics', 'lowstock']) {
  const r = (await req(`/reports/${k}`, 'GET', null, OT)).data;
  ok(`report: ${k}`, Array.isArray(r.rows), `${r.rows?.length} rows`);
}
const dash = (await req('/reports/dashboard', 'GET', null, OT)).data;
ok('dashboard expiry bands', dash.expiring_30 && dash.expiring_60 && dash.expiring_90);
ok('dashboard batch summary', typeof dash.batch_summary?.batches === 'number');
ok('dashboard brand & generic sales', Array.isArray(dash.top_brands) && Array.isArray(dash.top_generics));

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

console.log('— Discounts & offers —');
const promosActive = (await req('/promotions/active', 'GET', null, T)).data;
ok('active offers listed', promosActive.promotions.length >= 1, `${promosActive.promotions.length} live`);
const newPromo = (await req('/promotions', 'POST', {
  name: 'E2E Flash Sale', discount_type: 'percent', discount_value: 8, applies_to: 'all',
  from_date: '2000-01-01', to_date: '2099-12-31', min_bill_amount: 0,
}, OT)).data;
ok('offer created by owner', !!newPromo.id);
const promoDenied = await req('/promotions', 'POST', {
  name: 'Nope', discount_type: 'percent', discount_value: 5, from_date: '2000-01-01', to_date: '2099-12-31',
}, T);
ok('billing staff cannot create offers', promoDenied.status === 403);

// Retry once with the server-stated total (avoids paisa rounding mismatches)
const tryPay = async (body, token, guess) => {
  let r = await req('/sales', 'POST', { ...body, payment: { cash: guess, upi: 0, card: 0, credit: 0 } }, token);
  const m = r.status === 400 && (r.data.error || '').match(/bill total \(₹([\d.]+)\)/);
  if (m) r = await req('/sales', 'POST', { ...body, payment: { cash: Number(m[1]), upi: 0, card: 0, credit: 0 } }, token);
  return r;
};

const dItem = (await req('/inventory/medicines/pos-search?q=pan', 'GET', null, T)).data.results[0];
const smallDisc = await tryPay({
  items: [{ batch_id: dItem.batch_id, qty: 2 }], discount: { type: 'percent', value: 4 },
}, T, Math.round(2 * dItem.selling_price * 0.96));
ok('discount within limit works', smallDisc.status === 200, smallDisc.data.invoice_no);

const approved = await tryPay({
  items: [{ batch_id: dItem.batch_id, qty: 2 }], discount: { type: 'percent', value: 25 },
  approval: { email: 'priya@rsgroup.in', password: 'rsgroup123' },
}, T, Math.round(2 * dItem.selling_price * 0.75));
ok('manager approval unlocks big discount', approved.status === 200 && !!approved.data.sale?.discount_approved_by,
  approved.data.invoice_no);

const promoSale = await tryPay({
  items: [{ batch_id: dItem.batch_id, qty: 2 }], discount: { type: 'promo', promo_id: newPromo.id },
}, T, Math.round(2 * dItem.selling_price * 0.92));
ok('promotional offer applies at billing', promoSale.status === 200 && promoSale.data.sale?.promo_id === newPromo.id,
  promoSale.data.invoice_no || promoSale.data.error);

const custs = (await req('/customers?limit=50', 'GET', null, OT)).data;
const specialCust = custs.customers.find(c => Number(c.discount_percent) > 0);
ok('customer profile carries special discount', !!specialCust, specialCust ? `${specialCust.name} ${specialCust.discount_percent}%` : '');
const itemDiscSale = await tryPay({
  items: [{ batch_id: dItem.batch_id, qty: 2, discount: 6 }],
}, T, Math.round(2 * dItem.selling_price - 6));
ok('item-wise discount works', itemDiscSale.status === 200 && itemDiscSale.data.sale?.item_discount === 6);

const discRep = (await req('/reports/discounts?from=2000-01-01&to=2099-12-31', 'GET', null, OT)).data;
ok('discount report (bill-wise)', Array.isArray(discRep.rows) && discRep.rows.length > 0, `${discRep.rows?.length} rows`);
for (const g of ['branch', 'user', 'customer', 'product']) {
  const gr = (await req(`/reports/discounts?group=${g}&from=2000-01-01&to=2099-12-31`, 'GET', null, OT)).data;
  ok(`discount report (${g}-wise)`, Array.isArray(gr.rows), `${gr.rows?.length} rows`);
}
const promoDel = (await req(`/promotions/${newPromo.id}`, 'DELETE', null, OT)).data;
ok('used offer deactivated not deleted', promoDel.deactivated === true);

console.log('— Stock update notifications —');
const invT = (await req('/auth/login', 'POST', { email: 'vignesh@rsgroup.in', password: 'rsgroup123' })).data.token;
const stockRows = (await req('/inventory/stock?q=', 'GET', null, invT)).data.stock;
const adjBatch = stockRows.find(b => b.qty > 0);
const topUp = await req('/inventory/adjustments', 'POST', { batch_id: adjBatch.id, qty_change: 7, reason: 'e2e stock top-up' }, invT);
ok('positive stock adjustment', topUp.status === 200);
const stockNotifs = (await req('/staff/stock-notifications', 'GET', null, T)).data;
ok('stock update notification created', stockNotifs.total >= 1, `${stockNotifs.total} total`);
const latest = stockNotifs.notifications[0];
const payload = JSON.parse(latest?.data || '{}');
ok('notification has item details', payload.items?.length > 0 && payload.items[0].qty_added > 0 && !!payload.updated_by,
  payload.items?.[0] ? `${payload.items[0].name} +${payload.items[0].qty_added} → ${payload.items[0].new_qty}` : '');
const markRead = await req('/staff/notifications/read', 'POST', { ids: [latest.id] }, T);
ok('stock notification mark-as-read', markRead.status === 200);

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

console.log('— Usage & cost monitor —');
const usage = (await req('/admin/usage', 'GET', null, OT)).data;
ok('usage: db size + table breakdown', usage.db_bytes > 0 && Array.isArray(usage.tables) && usage.tables.length > 10, `${(usage.db_bytes / 1048576).toFixed(1)} MB, ${usage.tables?.length} tables`);
ok('usage: blob + growth + recommendations', !!usage.blobs && !!usage.growth && Array.isArray(usage.recommendations) && usage.providers.length === 3);
const usageDenied = await req('/admin/usage', 'GET', null, T);
ok('usage: billing staff denied', usageDenied.status === 403);
const clean = await req('/admin/usage/cleanup', 'POST', { target: 'sessions' }, OT);
ok('usage: cleanup runs', clean.status === 200 && typeof clean.data.removed === 'number');
const cleanBad = await req('/admin/usage/cleanup', 'POST', { target: 'nope' }, OT);
ok('usage: unknown cleanup target rejected', cleanBad.status === 400);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
