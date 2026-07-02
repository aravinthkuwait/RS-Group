import bcrypt from 'bcryptjs';
import db from './db.js';
import { DEFAULT_ROLE_PERMISSIONS } from './auth.js';
import { round2 } from './util.js';

const count = db.prepare('SELECT COUNT(*) AS c FROM branches').get().c;
if (count > 0 && !process.argv.includes('--force')) {
  console.log('Database already seeded. Run with --force to wipe and reseed.');
  process.exit(0);
}

console.log('Seeding RS Group sample data...');

// Delete in dependency order (children before the rows they reference)
db.exec(`
  DELETE FROM return_items; DELETE FROM returns;
  DELETE FROM supplier_payments; DELETE FROM payments;
  DELETE FROM sale_items; DELETE FROM sales;
  DELETE FROM purchase_return_items; DELETE FROM purchase_returns;
  DELETE FROM purchase_items; DELETE FROM purchases;
  DELETE FROM stock_transfer_items; DELETE FROM stock_transfers;
  DELETE FROM stock_adjustments; DELETE FROM stock_batches;
  DELETE FROM expenses; DELETE FROM cash_closings;
  DELETE FROM staff_attendance; DELETE FROM tasks;
  DELETE FROM notifications; DELETE FROM audit_logs;
  DELETE FROM login_history; DELETE FROM sessions;
  DELETE FROM customers; DELETE FROM medicines; DELETE FROM suppliers;
  DELETE FROM permissions; DELETE FROM users; DELETE FROM branches;
  DELETE FROM settings;
  DELETE FROM sqlite_sequence;
`);

// ---------- Role permission matrix ----------
const insPerm = db.prepare('INSERT INTO permissions (role, permission) VALUES (?,?)');
for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
  if (role === 'super_admin') continue; // implicit all
  for (const p of perms) insPerm.run(role, p);
}

// ---------- Settings ----------
const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?,?)');
setSetting.run('company', JSON.stringify({
  name: 'RS Group',
  tagline: 'Empowering Health, Enriching Education, Excelling in Sports',
  division: 'RS Group Health Care - Medical Shops',
  address: '12, Anna Salai, Chennai, Tamil Nadu 600002',
  phone: '+91 98400 12345',
  email: 'healthcare@rsgroup.in',
  gstin: '33AABCR1234F1Z5',
  drug_license: 'TN-CHE-123456',
  logo: '/rs-group-logo.jpg',
}));
setSetting.run('invoice', JSON.stringify({
  prefix_note: 'GST Invoice - Pharmacy Retail',
  footer: 'Get well soon! Goods once sold on prescription cannot be taken back. E&OE.',
  terms: 'Please retain this bill for returns/exchange within 7 days with original packaging.',
  show_savings: true,
}));
setSetting.run('gst_rates', JSON.stringify([0, 5, 12, 18]));
setSetting.run('payment_types', JSON.stringify(['cash', 'upi', 'card', 'credit']));
setSetting.run('medicine_categories', JSON.stringify([
  'Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Inhaler',
  'Surgical', 'Ayurvedic', 'Baby Care', 'Wellness', 'General',
]));
setSetting.run('expense_categories', JSON.stringify([
  'Rent', 'Salary', 'Electricity', 'Internet', 'Transport', 'Cleaning', 'Stationery', 'Tea & Snacks', 'Miscellaneous',
]));

// ---------- Branches (3) ----------
const insBranch = db.prepare(`INSERT INTO branches (code, name, address, city, phone, email, gstin, drug_license)
  VALUES (?,?,?,?,?,?,?,?)`);
const branches = [
  ['RSG-CHN', 'RS Medicals - Chennai Main', '12, Anna Salai, Mount Road', 'Chennai', '+91 98400 11111', 'chennai@rsgroup.in', '33AABCR1234F1Z5', 'TN-CHE-123456'],
  ['RSG-MDU', 'RS Medicals - Madurai', '45, West Masi Street', 'Madurai', '+91 98400 22222', 'madurai@rsgroup.in', '33AABCR1234F2Z4', 'TN-MDU-223344'],
  ['RSG-CBE', 'RS Medicals - Coimbatore', '78, DB Road, RS Puram', 'Coimbatore', '+91 98400 33333', 'coimbatore@rsgroup.in', '33AABCR1234F3Z3', 'TN-CBE-334455'],
];
const branchIds = branches.map(b => insBranch.run(...b).lastInsertRowid);

// ---------- Users (1 owner + 10 staff) ----------
const hash = bcrypt.hashSync('rsgroup123', 10);
const insUser = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, branch_id)
  VALUES (?,?,?,?,?,?)`);
const users = [
  ['Rajan S', 'owner@rsgroup.in', '+91 90000 00001', 'super_admin', null],
  ['Priya Venkat', 'priya@rsgroup.in', '+91 90000 00002', 'branch_admin', branchIds[0]],
  ['Karthik Raja', 'karthik@rsgroup.in', '+91 90000 00003', 'branch_manager', branchIds[1]],
  ['Meena Kumari', 'meena@rsgroup.in', '+91 90000 00004', 'branch_manager', branchIds[2]],
  ['Suresh Kumar', 'suresh@rsgroup.in', '+91 90000 00005', 'billing_staff', branchIds[0]],
  ['Divya Bharathi', 'divya@rsgroup.in', '+91 90000 00006', 'billing_staff', branchIds[1]],
  ['Arun Prakash', 'arun@rsgroup.in', '+91 90000 00007', 'billing_staff', branchIds[2]],
  ['Vignesh M', 'vignesh@rsgroup.in', '+91 90000 00008', 'inventory_staff', branchIds[0]],
  ['Lakshmi Narayanan', 'lakshmi@rsgroup.in', '+91 90000 00009', 'accountant', branchIds[0]],
  ['Ganesh Moorthy', 'ganesh@rsgroup.in', '+91 90000 00010', 'delivery_staff', branchIds[0]],
  ['Anitha Ravi', 'auditor@rsgroup.in', '+91 90000 00011', 'auditor', null],
];
const userIds = users.map(u => insUser.run(u[0], u[1], u[2], hash, u[3], u[4]).lastInsertRowid);
const billingStaff = { [branchIds[0]]: userIds[4], [branchIds[1]]: userIds[5], [branchIds[2]]: userIds[6] };

// ---------- Suppliers (10) ----------
const insSupplier = db.prepare(`INSERT INTO suppliers (name, contact_person, phone, email, address, gstin, opening_balance)
  VALUES (?,?,?,?,?,?,?)`);
const suppliers = [
  ['Sun Pharma Distributors', 'Ramesh Iyer', '+91 98411 10001', 'orders@sunpharmadist.in', 'Guindy, Chennai', '33AAACS1111A1Z1', 0],
  ['Apollo Medico Agencies', 'Vikram Shah', '+91 98411 10002', 'sales@apollomedico.in', 'T Nagar, Chennai', '33AAACA2222B1Z2', 12500],
  ['Cipla South Distributors', 'Farhan Ali', '+91 98411 10003', 'south@cipladist.in', 'Egmore, Chennai', '33AAACC3333C1Z3', 0],
  ['GSK Pharma Traders', 'Deepa Nair', '+91 98411 10004', 'gsk@pharmatraders.in', 'Madurai', '33AAACG4444D1Z4', 8200],
  ['Mankind Medicos', 'Rohit Jain', '+91 98411 10005', 'mankind@medicos.in', 'Coimbatore', '33AAACM5555E1Z5', 0],
  ['Dr Reddys Agencies', 'Sunil Reddy', '+91 98411 10006', 'drl@agencies.in', 'Chennai', '33AAACD6666F1Z6', 0],
  ['Zydus Wellness Supply', 'Amit Patel', '+91 98411 10007', 'zydus@wellness.in', 'Madurai', '33AAACZ7777G1Z7', 5400],
  ['Alkem Pharma Depot', 'Nikhil Rao', '+91 98411 10008', 'alkem@depot.in', 'Coimbatore', '33AAACA8888H1Z8', 0],
  ['Torrent Medi Supply', 'Kavitha S', '+91 98411 10009', 'torrent@medisupply.in', 'Chennai', '33AAACT9999I1Z9', 0],
  ['Micro Labs Distributors', 'Prabhu D', '+91 98411 10010', 'micro@labs.in', 'Salem', '33AAACM0000J1Z0', 3100],
];
const supplierIds = suppliers.map(s => insSupplier.run(...s).lastInsertRowid);

// ---------- Medicines (50) ----------
// [name, generic, category, brand, gst, unit, minStock, rx, mrp, purchase]
const meds = [
  ['Dolo 650mg', 'Paracetamol', 'Tablet', 'Micro Labs', 12, 'Strip', 30, 0, 33.60, 22.50],
  ['Crocin Advance 500mg', 'Paracetamol', 'Tablet', 'GSK', 12, 'Strip', 25, 0, 30.75, 20.10],
  ['Azithral 500mg', 'Azithromycin', 'Tablet', 'Alembic', 12, 'Strip', 15, 1, 119.50, 78.00],
  ['Augmentin 625 Duo', 'Amoxicillin + Clavulanate', 'Tablet', 'GSK', 12, 'Strip', 15, 1, 223.45, 152.00],
  ['Pan 40mg', 'Pantoprazole', 'Tablet', 'Alkem', 12, 'Strip', 25, 0, 128.00, 82.00],
  ['Pan-D', 'Pantoprazole + Domperidone', 'Capsule', 'Alkem', 12, 'Strip', 25, 0, 199.00, 128.00],
  ['Shelcal 500', 'Calcium + Vit D3', 'Tablet', 'Torrent', 12, 'Strip', 20, 0, 112.55, 74.00],
  ['Ecosprin 75mg', 'Aspirin', 'Tablet', 'USV', 12, 'Strip', 20, 1, 8.50, 5.20],
  ['Telma 40mg', 'Telmisartan', 'Tablet', 'Glenmark', 12, 'Strip', 20, 1, 216.00, 142.00],
  ['Amlong 5mg', 'Amlodipine', 'Tablet', 'Micro Labs', 12, 'Strip', 20, 1, 64.00, 41.00],
  ['Glycomet GP2', 'Metformin + Glimepiride', 'Tablet', 'USV', 12, 'Strip', 20, 1, 172.00, 112.00],
  ['Janumet 50/500', 'Sitagliptin + Metformin', 'Tablet', 'MSD', 12, 'Strip', 12, 1, 296.00, 210.00],
  ['Thyronorm 50mcg', 'Thyroxine', 'Tablet', 'Abbott', 12, 'Bottle', 15, 1, 137.00, 92.00],
  ['Atorva 10mg', 'Atorvastatin', 'Tablet', 'Zydus', 12, 'Strip', 20, 1, 71.00, 45.00],
  ['Rosuvas 10mg', 'Rosuvastatin', 'Tablet', 'Sun Pharma', 12, 'Strip', 15, 1, 249.00, 164.00],
  ['Montek LC', 'Montelukast + Levocetirizine', 'Tablet', 'Sun Pharma', 12, 'Strip', 20, 1, 159.00, 102.00],
  ['Allegra 120mg', 'Fexofenadine', 'Tablet', 'Sanofi', 12, 'Strip', 20, 0, 218.75, 145.00],
  ['Cetzine 10mg', 'Cetirizine', 'Tablet', 'GSK', 12, 'Strip', 25, 0, 27.00, 16.80],
  ['Zerodol SP', 'Aceclofenac + Serratiopeptidase', 'Tablet', 'Ipca', 12, 'Strip', 20, 0, 121.00, 78.00],
  ['Combiflam', 'Ibuprofen + Paracetamol', 'Tablet', 'Sanofi', 12, 'Strip', 25, 0, 48.02, 30.50],
  ['Meftal Spas', 'Mefenamic Acid + Dicyclomine', 'Tablet', 'Blue Cross', 12, 'Strip', 20, 0, 45.00, 28.00],
  ['Drotin M', 'Drotaverine + Mefenamic', 'Tablet', 'Walter Bushnell', 12, 'Strip', 15, 0, 108.00, 70.00],
  ['Benadryl Cough Syrup 100ml', 'Diphenhydramine', 'Syrup', 'J&J', 12, 'Bottle', 15, 0, 118.00, 76.00],
  ['Ascoril LS 100ml', 'Ambroxol + Levosalbutamol', 'Syrup', 'Glenmark', 12, 'Bottle', 15, 1, 132.00, 86.00],
  ['Grilinctus 100ml', 'Dextromethorphan', 'Syrup', 'Franco-Indian', 12, 'Bottle', 12, 0, 105.00, 68.00],
  ['Digene Gel Mint 200ml', 'Antacid Gel', 'Syrup', 'Abbott', 12, 'Bottle', 15, 0, 132.50, 85.00],
  ['Cremaffin Plus 225ml', 'Liquid Paraffin + Milk of Magnesia', 'Syrup', 'Abbott', 12, 'Bottle', 12, 0, 178.00, 116.00],
  ['Electral Powder 21g', 'ORS', 'General', 'FDC', 12, 'Sachet', 40, 0, 22.00, 14.00],
  ['Enterogermina 5ml', 'Bacillus Clausii', 'General', 'Sanofi', 12, 'Bottle', 20, 0, 54.00, 35.00],
  ['Sporlac DS', 'Lactic Acid Bacillus', 'Tablet', 'Sanzyme', 12, 'Strip', 15, 0, 108.00, 70.00],
  ['Becosules Capsules', 'B-Complex + Vit C', 'Capsule', 'Pfizer', 12, 'Strip', 25, 0, 51.00, 32.00],
  ['Zincovit', 'Multivitamin + Zinc', 'Tablet', 'Apex', 12, 'Strip', 25, 0, 110.00, 71.00],
  ['Neurobion Forte', 'B-Complex', 'Tablet', 'P&G', 12, 'Strip', 20, 0, 39.44, 25.00],
  ['Evion 400mg', 'Vitamin E', 'Capsule', 'P&G', 12, 'Strip', 15, 0, 38.00, 24.00],
  ['Limcee 500mg', 'Vitamin C', 'Tablet', 'Abbott', 12, 'Strip', 20, 0, 25.00, 15.50],
  ['Volini Spray 100g', 'Diclofenac Spray', 'Ointment', 'Sun Pharma', 18, 'Unit', 10, 0, 335.00, 225.00],
  ['Moov Cream 50g', 'Pain Relief Cream', 'Ointment', 'Reckitt', 18, 'Unit', 12, 0, 190.00, 126.00],
  ['Soframycin 30g', 'Framycetin', 'Ointment', 'Sanofi', 12, 'Unit', 12, 0, 66.00, 42.00],
  ['Betadine 5% 20g', 'Povidone Iodine', 'Ointment', 'Win-Medicare', 12, 'Unit', 12, 0, 118.00, 76.00],
  ['Candid Cream 20g', 'Clotrimazole', 'Ointment', 'Glenmark', 12, 'Unit', 12, 0, 118.00, 76.00],
  ['Otrivin Nasal Drops', 'Xylometazoline', 'Drops', 'GSK', 12, 'Unit', 15, 0, 105.00, 68.00],
  ['Ciplox Eye Drops', 'Ciprofloxacin', 'Drops', 'Cipla', 12, 'Unit', 12, 1, 22.00, 14.00],
  ['Refresh Tears 10ml', 'CMC Eye Drops', 'Drops', 'Allergan', 12, 'Unit', 12, 0, 195.00, 130.00],
  ['Asthalin Inhaler', 'Salbutamol', 'Inhaler', 'Cipla', 12, 'Unit', 10, 1, 174.00, 115.00],
  ['Human Mixtard 30/70', 'Insulin', 'Injection', 'Novo Nordisk', 5, 'Vial', 8, 1, 176.00, 120.00],
  ['Dettol Antiseptic 250ml', 'Antiseptic Liquid', 'General', 'Reckitt', 18, 'Bottle', 15, 0, 190.00, 128.00],
  ['ORS-L Apple 200ml', 'Electrolyte Drink', 'Wellness', 'JNTL', 12, 'Tetra', 30, 0, 35.00, 22.00],
  ['Accu-Chek Active Strips 50', 'Glucometer Strips', 'Surgical', 'Roche', 12, 'Box', 8, 0, 1020.00, 720.00],
  ['Digital Thermometer MT-101', 'Thermometer', 'Surgical', 'Dr Morepen', 18, 'Unit', 8, 0, 250.00, 155.00],
  ['Cotton Roll 100g', 'Absorbent Cotton', 'Surgical', 'Ramaraju', 5, 'Unit', 20, 0, 62.00, 38.00],
];
const insMed = db.prepare(`INSERT INTO medicines (name, generic_name, category, brand, barcode, hsn, gst_rate, unit, rack_location, min_stock, prescription_required)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const racks = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'D1', 'D2'];
const medIds = meds.map((m, i) => insMed.run(
  m[0], m[1], m[2], m[3],
  `890${String(1000000000 + i * 7919).slice(0, 10)}`,
  m[2] === 'Surgical' ? '9018' : '3004',
  m[4], m[5], racks[i % racks.length] + '-' + (Math.floor(i / 10) + 1), m[6], m[7],
).lastInsertRowid);

// Deterministic pseudo-random for reproducible sample data
let seedVal = 42;
const rand = () => { seedVal = (seedVal * 1103515245 + 12345) % 2147483648; return seedVal / 2147483648; };
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = arr => arr[randInt(0, arr.length - 1)];

const iso = d => d.toISOString().slice(0, 10);
const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// ---------- Purchases + stock batches ----------
const insPurchase = db.prepare(`INSERT INTO purchases (branch_id, supplier_id, invoice_no, invoice_date, subtotal, gst_amount, total, paid_amount, status, created_by)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
const insPurchaseItem = db.prepare(`INSERT INTO purchase_items (purchase_id, medicine_id, batch_id, batch_no, expiry_date, qty, free_qty, purchase_price, mrp, selling_price, gst_rate, amount)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const insBatch = db.prepare(`INSERT INTO stock_batches (medicine_id, branch_id, supplier_id, batch_no, expiry_date, mrp, purchase_price, selling_price, qty)
  VALUES (?,?,?,?,?,?,?,?,?)`);

let purchaseSeq = 1;
for (const branchId of branchIds) {
  // 4 purchase invoices per branch covering all 50 medicines
  for (let p = 0; p < 4; p++) {
    const supplierId = supplierIds[randInt(0, 9)];
    const invDate = daysFromNow(-randInt(20, 90));
    const pid = insPurchase.run(branchId, supplierId, `PINV-${2026}${String(purchaseSeq++).padStart(4, '0')}`,
      invDate, 0, 0, 0, 0, 'received', userIds[7]).lastInsertRowid;
    let subtotal = 0, gstAmt = 0;
    for (let mi = p; mi < meds.length; mi += 4) {
      const m = meds[mi];
      const medId = medIds[mi];
      // A few items seeded near/below min stock so low-stock alerts have demo data
      const qty = mi % 11 === 3 ? randInt(3, 12) : randInt(30, 120);
      const batchNo = `B${randInt(1000, 9999)}${String.fromCharCode(65 + randInt(0, 25))}`;
      // Mix of expiry horizons: some already expired / near expiry for alert demos
      const expiryDays = mi % 17 === 0 ? -randInt(5, 40) : mi % 7 === 0 ? randInt(10, 85) : randInt(120, 720);
      const expiry = daysFromNow(expiryDays);
      const sellingPrice = round2(m[8] * 0.98);
      const batchId = insBatch.run(medId, branchId, supplierId, batchNo, expiry, m[8], m[9], sellingPrice, qty).lastInsertRowid;
      const amount = round2(qty * m[9]);
      const gst = round2(amount * m[4] / (100 + m[4]));
      insPurchaseItem.run(pid, medId, batchId, batchNo, expiry, qty, 0, m[9], m[8], sellingPrice, m[4], amount);
      subtotal += amount - gst; gstAmt += gst;
    }
    const total = round2(subtotal + gstAmt);
    const paid = p % 3 === 0 ? round2(total * 0.5) : total; // some pending supplier dues
    db.prepare('UPDATE purchases SET subtotal=?, gst_amount=?, total=?, paid_amount=? WHERE id=?')
      .run(round2(subtotal), round2(gstAmt), total, paid, pid);
    if (paid > 0) {
      db.prepare(`INSERT INTO supplier_payments (supplier_id, branch_id, purchase_id, amount, method, date, created_by)
                  VALUES (?,?,?,?,?,?,?)`)
        .run(supplierId, branchId, pid, paid, 'bank', invDate, userIds[8]);
    }
  }
}

// ---------- Customers (24) ----------
const firstNames = ['Ravi', 'Sita', 'Kumar', 'Anjali', 'Vijay', 'Deepa', 'Mohan', 'Fatima', 'Senthil', 'Rekha', 'Ibrahim', 'Janaki', 'Prakash', 'Nithya', 'Saravanan', 'Kala', 'David', 'Uma', 'Rajesh', 'Bhavani', 'Mani', 'Shalini', 'Gopal', 'Radha'];
const insCustomer = db.prepare(`INSERT INTO customers (branch_id, name, phone, email, address, loyalty_points, credit_limit)
  VALUES (?,?,?,?,?,?,?)`);
const customerIds = firstNames.map((n, i) => insCustomer.run(
  branchIds[i % 3], `${n} ${pick(['S', 'K', 'M', 'R', 'V'])}`,
  `+91 9${String(500000000 + i * 1237913).slice(0, 9)}`,
  '', pick(['Anna Nagar', 'KK Nagar', 'Gandhi Street', 'Bazaar Road', 'Lake View Colony']),
  randInt(0, 250), i % 5 === 0 ? 5000 : 0,
).lastInsertRowid);

// ---------- Sales (100 bills over last 30 days) ----------
const insSale = db.prepare(`INSERT INTO sales (invoice_no, branch_id, customer_id, staff_id, subtotal, discount, gst_amount, round_off, total, paid_cash, paid_upi, paid_card, credit_amount, status, doctor_name, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insSaleItem = db.prepare(`INSERT INTO sale_items (sale_id, medicine_id, batch_id, batch_no, qty, mrp, price, purchase_price, gst_rate, gst_amount, discount, total)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const decBatch = db.prepare('UPDATE stock_batches SET qty = qty - ? WHERE id = ?');
const branchCodes = { [branchIds[0]]: 'RSG-CHN', [branchIds[1]]: 'RSG-MDU', [branchIds[2]]: 'RSG-CBE' };
const seqByBranch = {};
const doctors = ['', '', 'Dr. Natarajan', 'Dr. Shanthi', 'Dr. Abdul Kareem', '', 'Dr. Rebecca', ''];

for (let s = 0; s < 100; s++) {
  const branchId = branchIds[s % 3];
  const daysAgo = Math.floor(s / 3.4); // spread over ~30 days
  const dt = new Date(); dt.setDate(dt.getDate() - daysAgo);
  dt.setHours(randInt(9, 21), randInt(0, 59), randInt(0, 59));
  const createdAt = dt.toISOString().replace('T', ' ').slice(0, 19);
  const customerId = rand() < 0.75 ? customerIds[randInt(0, customerIds.length - 1)] : null;
  const staffId = billingStaff[branchId];
  seqByBranch[branchId] = (seqByBranch[branchId] || 0) + 1;
  const invoiceNo = `${branchCodes[branchId]}/${dt.getFullYear()}/${String(seqByBranch[branchId]).padStart(5, '0')}`;

  const nItems = randInt(1, 5);
  const usedMeds = new Set();
  const items = [];
  let subtotal = 0, gstTotal = 0;
  for (let it = 0; it < nItems; it++) {
    let mi; do { mi = randInt(0, 49); } while (usedMeds.has(mi));
    usedMeds.add(mi);
    const medId = medIds[mi];
    const batch = db.prepare(`SELECT * FROM stock_batches WHERE medicine_id=? AND branch_id=? AND qty>2 ORDER BY expiry_date LIMIT 1`).get(medId, branchId);
    if (!batch) continue;
    const qty = randInt(1, 3);
    const price = batch.selling_price;
    const lineTotal = round2(qty * price);
    const gst = round2(lineTotal * meds[mi][4] / (100 + meds[mi][4]));
    items.push({ medId, batch, qty, price, mrp: batch.mrp, gst, gstRate: meds[mi][4], lineTotal, pp: batch.purchase_price });
    subtotal += lineTotal; gstTotal += gst;
  }
  if (!items.length) continue;
  const discount = rand() < 0.2 ? round2(subtotal * 0.05) : 0;
  const gross = subtotal - discount;
  const total = Math.round(gross);
  const roundOff = round2(total - gross);
  // Payment mix
  let cash = 0, upi = 0, card = 0, credit = 0;
  const payMode = rand();
  if (customerId && payMode < 0.08) credit = total;
  else if (payMode < 0.45) cash = total;
  else if (payMode < 0.85) upi = total;
  else card = total;

  const saleId = insSale.run(invoiceNo, branchId, customerId, staffId,
    round2(subtotal), discount, round2(gstTotal), roundOff, total,
    cash, upi, card, credit, 'completed', pick(doctors), createdAt).lastInsertRowid;

  for (const it of items) {
    insSaleItem.run(saleId, it.medId, it.batch.id, it.batch.batch_no, it.qty, it.mrp, it.price, it.pp, it.gstRate, it.gst, 0, it.lineTotal);
    decBatch.run(it.qty, it.batch.id);
  }
  if (customerId) {
    db.prepare('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?')
      .run(Math.floor(total / 100), customerId);
  }
}

// ---------- Expenses ----------
const expenseCats = ['Rent', 'Salary', 'Electricity', 'Internet', 'Transport', 'Cleaning', 'Tea & Snacks'];
const insExpense = db.prepare(`INSERT INTO expenses (branch_id, category, amount, date, paid_method, notes, created_by)
  VALUES (?,?,?,?,?,?,?)`);
for (const branchId of branchIds) {
  insExpense.run(branchId, 'Rent', 25000, daysFromNow(-randInt(1, 28)), 'bank', 'Monthly shop rent', userIds[8]);
  insExpense.run(branchId, 'Salary', 68000, daysFromNow(-randInt(1, 28)), 'bank', 'Staff salaries', userIds[8]);
  for (let e = 0; e < 6; e++) {
    insExpense.run(branchId, pick(expenseCats.slice(2)), randInt(200, 3500), daysFromNow(-randInt(0, 28)), pick(['cash', 'upi']), '', userIds[8]);
  }
}

// ---------- Stock transfer sample ----------
const tBatch = db.prepare(`SELECT * FROM stock_batches WHERE branch_id=? AND qty>20 LIMIT 2`).all(branchIds[0]);
if (tBatch.length) {
  const tid = db.prepare(`INSERT INTO stock_transfers (from_branch_id, to_branch_id, status, notes, created_by)
    VALUES (?,?,?,?,?)`).run(branchIds[0], branchIds[1], 'pending', 'Restock fast movers', userIds[7]).lastInsertRowid;
  for (const b of tBatch) {
    db.prepare(`INSERT INTO stock_transfer_items (transfer_id, medicine_id, batch_id, qty) VALUES (?,?,?,?)`)
      .run(tid, b.medicine_id, b.id, 10);
  }
}

// ---------- Tasks & attendance ----------
const insTask = db.prepare(`INSERT INTO tasks (branch_id, assigned_to, title, description, status, due_date, created_by)
  VALUES (?,?,?,?,?,?,?)`);
insTask.run(branchIds[0], userIds[7], 'Verify expiry rack A1', 'Check all near-expiry stock in rack A1 and move to discount shelf', 'pending', daysFromNow(2), userIds[1]);
insTask.run(branchIds[0], userIds[4], 'Follow up credit customers', 'Call customers with pending credit above Rs.500', 'pending', daysFromNow(1), userIds[1]);
insTask.run(branchIds[0], userIds[9], 'Deliver order to Anna Nagar', 'Customer Ravi S - insulin delivery, keep cold pack', 'in_progress', daysFromNow(0), userIds[1]);
insTask.run(branchIds[1], userIds[5], 'Update rack labels', 'New rack layout stickers arrived', 'done', daysFromNow(-1), userIds[2]);

const insAtt = db.prepare(`INSERT INTO staff_attendance (user_id, branch_id, date, check_in, check_out, method)
  VALUES (?,?,?,?,?,?)`);
for (let d = 1; d <= 5; d++) {
  for (let u = 4; u < 10; u++) {
    insAtt.run(userIds[u], users[u][4], daysFromNow(-d), '09:0' + randInt(0, 9), d === 1 ? null : '21:1' + randInt(0, 9), 'mobile');
  }
}

// ---------- Welcome notifications ----------
db.prepare(`INSERT INTO notifications (branch_id, type, title, message) VALUES (NULL, 'info', 'Welcome to RS Group', 'Medical Shop Management System is ready. Explore the dashboard to get started.')`).run();

console.log('Seed complete:');
console.log(`  Branches:  ${db.prepare('SELECT COUNT(*) c FROM branches').get().c}`);
console.log(`  Users:     ${db.prepare('SELECT COUNT(*) c FROM users').get().c}`);
console.log(`  Medicines: ${db.prepare('SELECT COUNT(*) c FROM medicines').get().c}`);
console.log(`  Suppliers: ${db.prepare('SELECT COUNT(*) c FROM suppliers').get().c}`);
console.log(`  Batches:   ${db.prepare('SELECT COUNT(*) c FROM stock_batches').get().c}`);
console.log(`  Purchases: ${db.prepare('SELECT COUNT(*) c FROM purchases').get().c}`);
console.log(`  Sales:     ${db.prepare('SELECT COUNT(*) c FROM sales').get().c}`);
console.log(`  Customers: ${db.prepare('SELECT COUNT(*) c FROM customers').get().c}`);
console.log('\nLogin: owner@rsgroup.in / rsgroup123 (all sample users share password rsgroup123)');
