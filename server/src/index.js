import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';
import { authenticate } from './auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import inventoryRoutes from './routes/inventory.js';
import purchaseRoutes from './routes/purchases.js';
import salesRoutes from './routes/sales.js';
import customerRoutes from './routes/customers.js';
import accountsRoutes from './routes/accounts.js';
import reportsRoutes from './routes/reports.js';
import staffRoutes from './routes/staff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Auto-seed on first run so the app works out of the box
if (db.prepare('SELECT COUNT(*) c FROM branches').get().c === 0) {
  console.log('Empty database detected — seeding sample data...');
  await import('./seed.js');
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'RS Group Medical Shop Management System' }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', authenticate, adminRoutes);
app.use('/api/inventory', authenticate, inventoryRoutes);
app.use('/api/purchases', authenticate, purchaseRoutes);
app.use('/api/sales', authenticate, salesRoutes);
app.use('/api/customers', authenticate, customerRoutes);
app.use('/api/accounts', authenticate, accountsRoutes);
app.use('/api/reports', authenticate, reportsRoutes);
app.use('/api/staff', authenticate, staffRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));

// Serve the built web app (single deployable unit)
const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RS Group server running on http://localhost:${PORT}`);
});

// ---------- Scheduled reminders (low stock / expiry / dues / cash closing) ----------
function dailyChecks() {
  try {
    const branches = db.prepare('SELECT * FROM branches WHERE active = 1').all();
    for (const b of branches) {
      const low = db.prepare(`SELECT COUNT(*) c FROM (
        SELECT m.id FROM medicines m LEFT JOIN stock_batches sb ON sb.medicine_id = m.id AND sb.branch_id = ?
        WHERE m.active = 1 GROUP BY m.id HAVING COALESCE(SUM(sb.qty),0) <= m.min_stock)`).get(b.id).c;
      const expiring = db.prepare(`SELECT COUNT(*) c FROM stock_batches
        WHERE branch_id = ? AND qty > 0 AND expiry_date BETWEEN date('now') AND date('now','+30 days')`).get(b.id).c;
      const closedToday = db.prepare(`SELECT 1 FROM cash_closings WHERE branch_id = ? AND date = date('now')`).get(b.id);
      const notifyOnce = (type, title, message) => {
        const dup = db.prepare(`SELECT 1 FROM notifications WHERE branch_id = ? AND type = ? AND title = ? AND date(created_at) = date('now')`)
          .get(b.id, type, title);
        if (!dup) {
          db.prepare('INSERT INTO notifications (branch_id, type, title, message) VALUES (?,?,?,?)').run(b.id, type, title, message);
        }
      };
      if (low > 0) notifyOnce('stock', 'Low stock reminder', `${low} medicine(s) are at or below minimum stock in ${b.name}.`);
      if (expiring > 0) notifyOnce('expiry', 'Expiry reminder', `${expiring} batch(es) expire within 30 days in ${b.name}.`);
      const hour = new Date().getHours();
      if (hour >= 20 && !closedToday) notifyOnce('accounts', 'Cash closing pending', `Daily cash closing for ${b.name} has not been done yet.`);
    }
  } catch (e) {
    console.error('Scheduled check failed:', e.message);
  }
}
dailyChecks();
setInterval(dailyChecks, 60 * 60 * 1000);
