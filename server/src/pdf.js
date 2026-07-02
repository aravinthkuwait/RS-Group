import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSetting, round2 } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(__dirname, '..', '..', 'assets', 'rs-group-logo.jpg');

const BLUE = '#1e4d8c', GREEN = '#2e8b3d', ORANGE = '#e07b1f', GREY = '#555555', LIGHT = '#f0f4fa';
const rupee = n => `Rs. ${Number(n || 0).toFixed(2)}`;

function header(doc, branch, title) {
  const company = getSetting('company', {});
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

export function invoicePdf(res, sale, items, branch, customer, staff) {
  const invoiceCfg = getSetting('invoice', {});
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${sale.invoice_no.replaceAll('/', '-')}.pdf"`);
  doc.pipe(res);

  let y = header(doc, branch, 'TAX INVOICE');
  y += 8;
  // Invoice meta box
  doc.roundedRect(40, y, 515, 58, 4).fillAndStroke(LIGHT, '#d5dfef');
  doc.fillColor(GREY).font('Helvetica').fontSize(8.5);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Invoice No:', 50, y + 8).font('Helvetica').fillColor('#000').text(sale.invoice_no, 110, y + 8);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Date:', 50, y + 22).font('Helvetica').fillColor('#000').text(sale.created_at, 110, y + 22);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Billed By:', 50, y + 36).font('Helvetica').fillColor('#000').text(staff?.name || '-', 110, y + 36);
  doc.font('Helvetica-Bold').fillColor(BLUE).text('Customer:', 300, y + 8).font('Helvetica').fillColor('#000').text(customer ? `${customer.name} (${customer.phone})` : 'Walk-in Customer', 355, y + 8, { width: 190 });
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

  // Totals
  const savings = round2(items.reduce((a, it) => a + (it.mrp - it.price) * it.qty, 0) + sale.discount);
  const totals = [
    ['Subtotal', rupee(sale.subtotal)],
    ['Discount', `- ${rupee(sale.discount)}`],
    ['GST (included)', rupee(sale.gst_amount)],
    ['Round Off', rupee(sale.round_off)],
  ];
  totals.forEach(([label, val]) => {
    doc.font('Helvetica').fontSize(9).fillColor(GREY).text(label, 380, y, { width: 100, align: 'right' });
    doc.fillColor('#000').text(val, 480, y, { width: 72, align: 'right' });
    y += 13;
  });
  doc.rect(370, y, 185, 20).fill(GREEN);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11)
    .text('TOTAL', 380, y + 5, { width: 100, align: 'right' })
    .text(rupee(sale.total), 480, y + 5, { width: 70, align: 'right' });
  y += 26;
  const pays = [['Cash', sale.paid_cash], ['UPI', sale.paid_upi], ['Card', sale.paid_card], ['Credit', sale.credit_amount]]
    .filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${rupee(v)}`).join('    ');
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(`Payment - ${pays || 'N/A'}`, 40, y);
  if (invoiceCfg.show_savings && savings > 0) {
    doc.fillColor(ORANGE).font('Helvetica-Bold').text(`You saved ${rupee(savings)} on this bill!`, 40, y + 14);
  }
  y += 34;
  doc.font('Helvetica').fontSize(7.5).fillColor(GREY)
    .text(invoiceCfg.terms || '', 40, y, { width: 515 })
    .text(invoiceCfg.footer || '', 40, y + 20, { width: 515, align: 'center' });
  doc.end();
}

export function reportPdf(res, { title, branchName, period, columns, rows, summary = [] }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: columns.length > 7 ? 'landscape' : 'portrait' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${title.toLowerCase().replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);
  const pageW = doc.page.width - 80;
  let y = header(doc, { name: branchName || 'All Branches' }, title.toUpperCase());
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
  doc.end();
}
