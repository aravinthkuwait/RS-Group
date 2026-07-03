import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSetting } from './util.js';
import { header, stampFooter } from './pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUAL_MD = path.join(__dirname, '..', '..', 'docs', 'USER-MANUAL.md');

const BLUE = '#1e4d8c', GREEN = '#2e8b3d', GREY = '#555555';
const strip = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
  .replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

// Renders docs/USER-MANUAL.md into a branded PDF (headings, bullets, tables).
export async function manualPdf(res, printedBy = '') {
  const company = (await getSetting('company', {})) || {};
  const md = fs.readFileSync(MANUAL_MD, 'utf8');
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="rs-group-user-manual.pdf"');
  doc.pipe(res);

  let y = header(doc, null, 'USER MANUAL', company) + 6;
  const W = 515, X = 40;
  const need = (h) => { if (y + h > doc.page.height - 60) { doc.addPage(); y = 50; } };
  const para = (text, { size = 9, color = '#111111', font = 'Helvetica', indent = 0, gap = 4 } = {}) => {
    doc.font(font).fontSize(size).fillColor(color);
    const h = doc.heightOfString(text, { width: W - indent });
    need(h);
    doc.text(text, X + indent, y, { width: W - indent });
    y += h + gap;
  };

  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = strip(raw).trimEnd();

    if (raw.startsWith('# ')) { i++; continue; } // main title already in the page header
    if (!line.trim()) { i++; continue; }
    if (line.trim() === '---') {
      need(14);
      doc.moveTo(X, y + 4).lineTo(X + W, y + 4).lineWidth(0.7).strokeColor('#d5dfef').stroke();
      y += 14; i++; continue;
    }
    if (raw.startsWith('## ')) {
      y += 6; need(30);
      doc.rect(X, y, W, 20).fill(BLUE);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text(line.replace(/^## /, ''), X + 8, y + 5, { width: W - 16 });
      y += 26; i++; continue;
    }
    if (raw.startsWith('### ')) {
      y += 2;
      para(line.replace(/^### /, ''), { size: 10, color: GREEN, font: 'Helvetica-Bold', gap: 5 });
      i++; continue;
    }
    if (raw.startsWith('> ')) {
      para(line.replace(/^> /, ''), { size: 8.5, color: GREY, indent: 12, font: 'Helvetica-Oblique' });
      i++; continue;
    }
    // Markdown table
    if (raw.trim().startsWith('|')) {
      const tbl = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = strip(lines[i]).trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^-{2,}:?$|^:?-{2,}:?$/.test(c))) tbl.push(cells);
        i++;
      }
      const cols = Math.max(...tbl.map(r => r.length));
      const cw = W / cols;
      tbl.forEach((row, ri) => {
        doc.font(ri === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const rh = Math.max(...row.map(c => doc.heightOfString(c, { width: cw - 10 }))) + 7;
        need(rh);
        if (ri === 0) doc.rect(X, y, W, rh).fill(BLUE);
        else if (ri % 2 === 0) doc.rect(X, y, W, rh).fill('#f6f9fd');
        doc.fillColor(ri === 0 ? '#ffffff' : '#111111');
        row.forEach((c, ci) => doc.text(c, X + ci * cw + 5, y + 3.5, { width: cw - 10 }));
        y += rh;
      });
      y += 8; continue;
    }
    // Bullets / numbered lists
    const bullet = raw.match(/^(\s*)[-*] (.*)$/);
    if (bullet) {
      para('•  ' + strip(bullet[2]), { indent: 10 + bullet[1].length * 2, gap: 3 });
      i++; continue;
    }
    const num = raw.match(/^\s*(\d+)\. (.*)$/);
    if (num) {
      para(`${num[1]}.  ${strip(num[2])}`, { indent: 10, gap: 3 });
      i++; continue;
    }
    para(line);
    i++;
  }

  stampFooter(doc, printedBy);
  doc.end();
}
