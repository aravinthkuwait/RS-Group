import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSetting, round2 } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(__dirname, '..', '..', 'assets', 'rs-group-logo.jpg');

const BLUE = '#1e4d8c', GREEN = '#2e8b3d', ORANGE = '#e07b1f', GREY = '#555555', LIGHT = '#f0f4fa';
const rupee = n => `Rs. ${Number(n || 0).toFixed(2)}`;

export function header(doc, branch, title, company = {}) {
  if (fs.existsSync(LOGO)) {
    try { doc.image(LOGO, 40, 28, { width: 64 }); } catch { /* logo optional */ }
  }
  doc.font('Helvetica-Bold').fontSize(20).fillColor(BLUE).text(company.name || 'RS Group', 115, 32);
  doc.font('Helvetica').fontSize(9).fillColor(GREEN).text(company.division || 'Health Care Division', 115, 54);
  doc.fillColor(GREY).fontSize(8)
    .text(`${branch?.name || ''}  |  ${branch?.address || company.address || ''}`, 115, 66)
    .text(`Phone: ${branch?.phone || company.phone || ''}   GSTIN: ${branch?.gstin || company.gstin || ''}   DL: ${branch?.drug_license || company.drug_license || ''}`, 115, 77);
  doc.moveTo(40, 95).lineTo(555, 95).lineWidth(1.5).strokeColor(ORANGE).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(BLUE).text(title, 40, 102, { width: 515, align: 'center' });
  return 122;
}

export async function invoicePdf(res, sale, items, branch, customer, staff, printedBy = '') {
  const invoiceCfg = (await getSetting('invoice', {})) || {};
  const company = (await getSetting('company', {})) || {};
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${sale.invoice_no.replaceAll('/', '-')}.pdf"`);
  doc.pipe(res);

  let y = header(doc, branch, 'TAX INVOICE', company);
  y += 8;
  // Invoice meta box
  doc.roundedRect(40, y, 515, 58, 4).fillAndStroke(LIGHT, '#d5dfef');
  doc.fillColor(GREY).font('Helvetica').fontSize(8.5);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Invoice No:', 50, y + 8).font('Helvetica').fillColor('#000').text(sale.invoice_no, 110, y + 8);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Date:', 50, y + 22).font('Helvetica').fillColor('#000').text(sale.created_at, 110, y + 22);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Billed By:', 50, y + 36).font('Helvetica').fillColor('#000').text(staff?.name || '-', 110, y + 36);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Customer:', 300, y + 8).font('Helvetica').fillColor('#000')
    .text(customer
      ? `${customer.name} (${customer.phone})${customer.gstin ? ' · GSTIN ' + customer.gstin : ''}`
      : 'Walk-in Customer', 355, y + 8, { width: 190 });
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Doctor:', 300, y + 22).font('Helvetica').fillColor('#000').text(sale.doctor_name || '-', 355, y + 22);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Status:', 300, y + 36).font('Helvetica').fillColor('#000').text(sale.status.toUpperCase(), 355, y + 36);
  y += 70;

  // Items table
  const cols = [
    { label: '#', x: 42, w: 18 },
    { label: 'Item', x: 60, w: 170 },
    { label: 'Batch', x: 230, w: 60 },
    { label: 'Expiry', x: 290, w: 48 },
    { label: 'Qty', x: 338, w: 30, align: 'right' },
    { label: 'MRP', x: 368, w: 45, align: 'right' },
    { label: 'Rate', x: 413, w: 45, align: 'right' },
    { label: 'GST%', x: 458, w: 32, align: 'right' },
    { label: 'Amount', x: 490, w: 62, align: 'right' },
  ];
  doc.rect(40, y, 515, 16).fill(BLUE);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
  cols.forEach(c => doc.text(c.label, c.x, y + 4, { width: c.w, align: c.align || 'left' }));
  y += 16;
  doc.font('Helvetica').fontSize(8);
  items.forEach((it, i) => {
    if (y > 720) { doc.addPage(); y = 50; }
    if (i % 2) doc.rect(40, y, 515, 14).fill('#f6f9fd');
    doc.fillColor('#000');
    const vals = [String(i + 1), it.medicine_name, it.batch_no, (it.expiry_date || '').slice(0, 7), String(it.qty),
      Number(it.mrp).toFixed(2), Number(it.price).toFixed(2), String(it.gst_rate), Number(it.total).toFixed(2)];
    cols.forEach((c, ci) => doc.text(vals[ci], c.x, y + 3, { width: c.w, align: c.align || 'left', lineBreak: false }));
    y += 14;
  });
  doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  y += 8;

  // GST breakdown by rate (CGST/SGST split)
  const byRate = {};
  for (const it of items) {
    const r = (byRate[it.gst_rate] = byRate[it.gst_rate] || { taxable: 0, gst: 0 });
    r.taxable += it.total - it.gst_amount;
    r.gst += it.gst_amount;
  }
  const gstRows = Object.entries(byRate).sort((a, b) => a[0] - b[0]);
  const gy0 = y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text('GST BREAKDOWN', 40, y);
  let gy = y + 12;
  doc.rect(40, gy, 300, 13).fill(BLUE);
  doc.fillColor('#fff').fontSize(7.5);
  doc.text('GST %', 44, gy + 3, { width: 40 });
  doc.text('Taxable', 90, gy + 3, { width: 60, align: 'right' });
  doc.text('CGST', 155, gy + 3, { width: 55, align: 'right' });
  doc.text('SGST', 215, gy + 3, { width: 55, align: 'right' });
  doc.text('Total GST', 275, gy + 3, { width: 60, align: 'right' });
  gy += 13;
  doc.font('Helvetica').fillColor('#000');
  for (const [rate, v] of gstRows) {
    doc.text(`${rate}%`, 44, gy + 3, { width: 40 });
    doc.text(round2(v.taxable).toFixed(2), 90, gy + 3, { width: 60, align: 'right' });
    doc.text(round2(v.gst / 2).toFixed(2), 155, gy + 3, { width: 55, align: 'right' });
    doc.text(round2(v.gst / 2).toFixed(2), 215, gy + 3, { width: 55, align: 'right' });
    doc.text(round2(v.gst).toFixed(2), 275, gy + 3, { width: 60, align: 'right' });
    gy += 12;
  }
  doc.moveTo(40, gy + 1).lineTo(340, gy + 1).lineWidth(0.5).strokeColor('#cccccc').stroke();

  // Totals — gross, discounts, taxable, GST, net payable, paid, balance
  const itemDisc = round2(sale.item_discount || 0);
  const grossAmount = round2(sale.subtotal + itemDisc);
  const billDiscount = round2(sale.discount || 0);
  const totalDiscount = round2(itemDisc + billDiscount);
  const discountSavings = round2(items.reduce((a, it) => a + (it.mrp - it.price) * it.qty, 0) + totalDiscount);
  const paid = round2(sale.paid_cash + sale.paid_upi + sale.paid_card);
  const balance = round2(sale.credit_amount || 0);
  const discountLabel = sale.discount_type === 'promo' && sale.promo_name ? `Offer: ${sale.promo_name}`
    : sale.discount_type === 'customer' ? `Customer Discount (${Number(sale.discount_value)}%)`
    : sale.discount_type === 'percent' ? `Discount (${Number(sale.discount_value)}%)`
    : 'Discount';
  const totals = [
    ['Gross Amount', rupee(grossAmount)],
    ...(itemDisc > 0 ? [['Item Discounts', `- ${rupee(itemDisc)}`]] : []),
    ...(billDiscount > 0 || sale.discount_type !== 'none' ? [[discountLabel, `- ${rupee(billDiscount)}`]] : []),
    ['Taxable Amount', rupee(round2(sale.subtotal - billDiscount - sale.gst_amount))],
    ['GST (included)', rupee(sale.gst_amount)],
    ['Round Off', rupee(sale.round_off)],
  ];
  totals.forEach(([label, val]) => {
    doc.font('Helvetica').fontSize(9).fillColor(GREY).text(label, 360, y, { width: 120, align: 'right' });
    doc.fillColor('#000').text(val, 480, y, { width: 72, align: 'right' });
    y += 13;
  });
  doc.rect(370, y, 185, 20).fill(GREEN);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11)
    .text('NET PAYABLE', 380, y + 5, { width: 100, align: 'right' })
    .text(rupee(sale.total), 480, y + 5, { width: 70, align: 'right' });
  y += 24;
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY)
    .text('Paid Amount', 360, y, { width: 120, align: 'right' }).fillColor('#000').text(rupee(paid), 480, y, { width: 72, align: 'right' });
  y += 12;
  doc.fillColor(GREY).text('Balance (Credit)', 360, y, { width: 120, align: 'right' })
    .fillColor(balance > 0 ? ORANGE : '#000').text(rupee(balance), 480, y, { width: 72, align: 'right' });
  y += 14;
  y = Math.max(y, gy + 12);
  const pays = [['Cash', sale.paid_cash], ['UPI', sale.paid_upi], ['Card', sale.paid_card], ['Credit', sale.credit_amount]]
    .filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${rupee(v)}`).join('    ');
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(`Payment - ${pays || 'N/A'}`, 40, y);
  if (sale.discount_approved_by_name) {
    doc.text(`Discount approved by ${sale.discount_approved_by_name}`, 40, y + 12);
    y += 12;
  }
  if (discountSavings > 0) {
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(9.5)
      .text(`You saved ${rupee(discountSavings)} on this purchase!`, 40, y + 14);
  }
  y += 34;
  doc.font('Helvetica').fontSize(7.5).fillColor(GREY)
    .text(invoiceCfg.terms || '', 40, y, { width: 515 })
    .text(invoiceCfg.footer || '', 40, y + 20, { width: 515, align: 'center' });
  stampFooter(doc, printedBy);
  doc.end();
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

// English words for a whole rupee amount, Indian lakh/crore grouping (e.g. 499 -> "Four Hundred And Ninety Nine")
function numberToWords(num) {
  num = Math.round(num);
  if (num === 0) return 'Zero';
  const chunk = n => {
    let s = '';
    if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
    if (n > 0 && s) s += 'And ';
    if (n >= 20) { s += TENS[Math.floor(n / 10)] + ' '; n %= 10; }
    if (n > 0) s += ONES[n] + ' ';
    return s.trim();
  };
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const parts = [];
  if (crore) parts.push(`${chunk(crore)} Crore`);
  if (lakh) parts.push(`${chunk(lakh)} Lakh`);
  if (thousand) parts.push(`${chunk(thousand)} Thousand`);
  if (num) parts.push(chunk(num));
  return parts.join(' ');
}

// Compact 80mm thermal-roll receipt — wording/layout mirrors the standard
// Jan Aushadhi-style pharmacy bill (Bill No./Bill Date, Name/Add./Doct,
// SN|Description|Qty|Batch|Exp|Amount rows, round-off, amount in words).
export async function thermalReceiptPdf(res, sale, items, branch, customer, staff, printedBy = '') {
  const invoiceCfg = (await getSetting('invoice', {})) || {};
  const company = (await getSetting('company', {})) || {};
  const W = 227, M = 8, CW = W - M * 2;
  const doc = new PDFDocument({ size: [W, 210 + items.length * 9], margin: M });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${sale.invoice_no.replaceAll('/', '-')}.pdf"`);
  doc.pipe(res);

  const pad = (v, n, right = false) => {
    const s = String(v ?? '').slice(0, n);
    return right ? s.padStart(n) : s.padEnd(n);
  };
  const cols = [['SN', 2], ['DESCRIPTION', 18], ['QTY', 3, true], ['BATCH', 7], ['EXP', 5], ['AMOUNT', 8, true]];
  const row = vals => cols.map(([, n, right], i) => pad(vals[i], n, right)).join(' ');
  const dash = '-'.repeat(cols.reduce((a, [, n]) => a + n + 1, -1));
  const centered = (text, size, bold) => doc.font(bold ? 'Courier-Bold' : 'Courier').fontSize(size).text(text, { width: CW, align: 'center' });

  centered(company.name || 'RS Group', 9, true);
  if (company.division) centered(company.division, 6.5);
  centered(branch?.address || company.address || '', 6.5);
  const dl = branch?.drug_license || company.drug_license;
  if (dl) centered(`D.L.No.: ${dl}`, 6.5);
  const gstin = branch?.gstin || company.gstin;
  if (gstin) centered(`GSTIN : ${gstin}`, 6.5);
  if (branch?.phone || company.phone) centered(`Phone : ${branch?.phone || company.phone}`, 6.5);
  doc.moveDown(0.3);
  doc.font('Courier').fontSize(6.5).text(dash);
  doc.text(`Bill No.  : ${sale.invoice_no}`);
  doc.text(`Bill Date : ${sale.created_at}`);
  doc.text(dash);
  doc.text(`Name : ${customer ? `${customer.name} (${customer.phone})` : 'Walk-in Customer'}`);
  doc.text(`Add. : ${customer?.address || branch?.city || '-'}`);
  doc.text(`Doct : ${sale.doctor_name || '-'}`);
  doc.text(dash);
  doc.font('Courier-Bold').text(row(['SN', 'DESCRIPTION', 'QTY', 'BATCH', 'EXP', 'AMOUNT']));
  doc.text(dash);
  doc.font('Courier');
  items.forEach((it, i) => {
    doc.text(row([i + 1, it.medicine_name, it.qty, it.batch_no, (it.expiry_date || '').slice(2, 7), Number(it.total).toFixed(2)]));
  });
  doc.text(dash);

  const grossAmount = round2(sale.subtotal - sale.discount);
  doc.fontSize(7.5).text(`TOTAL :  ${grossAmount.toFixed(2)}`, { align: 'right' });
  if (sale.round_off) doc.text(`R.OFF: ${sale.round_off.toFixed(2)}`, { align: 'right' });
  doc.fontSize(6.5).text(dash);
  doc.font('Courier-Bold').fontSize(10).text(`Total Bill Value is : ${sale.total.toFixed(2)}`, { align: 'right' });
  doc.font('Courier').fontSize(6.5).text(`Rs. ${numberToWords(sale.total)} only`, { align: 'right' });
  const savings = round2(items.reduce((a, it) => a + (it.mrp - it.price) * it.qty, 0) + round2(sale.discount || 0) + round2(sale.item_discount || 0));
  if (savings > 0) doc.font('Courier').fontSize(7).text(`Today you saved Rs. ${savings.toFixed(2)}`, { align: 'right' });
  doc.moveDown(0.3);
  doc.fontSize(6.5).text(dash);
  if (invoiceCfg.terms) centered(invoiceCfg.terms, 6.5);
  centered(invoiceCfg.footer || 'Goods Once Sold Cannot be Taken Back or Exchange', 6.5);
  centered('Wishing You a Speedy Recovery', 6.5);
  centered('Have a Nice Day, >>>>> Thanking You <<<<<', 6.5);
  centered(`Printed by ${printedBy || staff?.name || ''} on ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`, 6);
  doc.end();
}

// Page number + printed-by footer on every buffered page
export function stampFooter(doc, printedBy) {
  const range = doc.bufferedPageRange();
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor('#8a8a8a')
      .text(printedBy ? `Downloaded by ${printedBy} on ${when}` : `Generated on ${when}`,
        40, doc.page.height - 26, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`,
        doc.page.width - 140, doc.page.height - 26, { width: 100, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

export async function reportPdf(res, { title, branchName, period, columns, rows, summary = [], printedBy = '' }) {
  const company = (await getSetting('company', {})) || {};
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, layout: columns.length > 7 ? 'landscape' : 'portrait' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);
  const pageW = doc.page.width - 80;
  let y = header(doc, { name: branchName || 'All Branches' }, title.toUpperCase(), company);
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(period || '', 40, y, { width: pageW, align: 'center' });
  y += 18;
  const colW = pageW / columns.length;
  const drawHead = () => {
    doc.rect(40, y, pageW, 16).fill(BLUE);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    columns.forEach((c, i) => doc.text(c.label, 44 + i * colW, y + 4, { width: colW - 8, align: c.align || 'left', lineBreak: false }));
    y += 16;
  };
  drawHead();
  doc.font('Helvetica').fontSize(7.5);
  rows.forEach((r, ri) => {
    if (y > doc.page.height - 70) { doc.addPage(); y = 50; drawHead(); doc.font('Helvetica').fontSize(7.5); }
    if (ri % 2) doc.rect(40, y, pageW, 13).fill('#f6f9fd');
    doc.fillColor('#000');
    columns.forEach((c, i) => {
      const v = r[c.key];
      doc.text(v === null || v === undefined ? '' : String(v), 44 + i * colW, y + 3, { width: colW - 8, align: c.align || 'left', lineBreak: false });
    });
    y += 13;
  });
  y += 10;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE);
  summary.forEach(([label, val]) => {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
    doc.text(`${label}: ${val}`, 40, y, { width: pageW, align: 'right' });
    y += 14;
  });
  stampFooter(doc, printedBy);
  doc.end();
}
