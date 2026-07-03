import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool, get, run, initSchema } from './db.js';
import { authenticate } from './auth.js';
import { runSeed } from './seed.js';
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

// Ensure schema exists; auto-seed sample data on a fresh database so the app
// works out of the box (set SEED_ON_EMPTY=0 to start with an empty database).
// Retries for ~60s so a slow-to-wake database doesn't kill the deploy, and the
// server always starts so the logs and /api/health explain what's wrong.
if (!process.env.DATABASE_URL) {
  console.error('*** DATABASE_URL is not set. ***');
  console.error('Add it in Railway → your service → Variables. Use the Supabase');
  console.error('"Session pooler" connection string with your database password.');
}
let dbReady = false;
let dbError = '';
for (let attempt = 1; attempt <= 12 && !dbReady; attempt++) {
  try {
    await initSchema();
    dbReady = true;
    console.log('Database connected and schema verified.');
  } catch (e) {
    dbError = e.message;
    console.error(`Database connection attempt ${attempt}/12 failed: ${e.message}`);
    if (attempt < 12) await new Promise(r => setTimeout(r, 5000));
  }
}
if (dbReady && process.env.SEED_ON_EMPTY !== '0') {
  const { rows: [{ c }] } = await pool.query('SELECT COUNT(*)::int AS c FROM branches');
  const wiped = (await pool.query(`SELECT 1 FROM settings WHERE key = 'demo_data_wiped'`)).rows.length > 0;
  if (c === 0 && !wiped) {
    console.log('Empty database detected — seeding sample data...');
    await runSeed({ force: true });
  }
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'RS Group Medical Shop Management System', database: 'postgres' });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: process.env.DATABASE_URL
        ? `Database unreachable: ${e.message}`
        : 'DATABASE_URL environment variable is not set',
    });
  }
});

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

// Serve the built web app (single deployable unit).
// Hashed assets are immutable → cache for a year; index.html must always be
// revalidated so browsers pick up new deployments immediately.
const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // A missing asset (e.g. a stale cached page requesting a bundle from an old
  // deployment) must get a clean 404 — never index.html served as JavaScript,
  // which renders as a blank white page in the browser.
  app.get('/assets/*', (req, res) => res.status(404).end());
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RS Group server running on http://localhost:${PORT}`);
});

// ---------- Scheduled reminders (low stock / expiry / dues / cash closing) ----------
async function dailyChecks() {
  try {
    const branches = (await pool.query('SELECT * FROM branches WHERE active = 1')).rows;
    for (const b of branches) {
      const low = (await get(`SELECT COUNT(*) AS c FROM (
        SELECT m.id FROM medicines m LEFT JOIN stock_batches sb ON sb.medicine_id = m.id AND sb.branch_id = ?
        WHERE m.active = 1 GROUP BY m.id HAVING COALESCE(SUM(sb.qty),0) <= MIN(m.min_stock)) t`, b.id)).c;
      const expiring = (await get(`SELECT COUNT(*) AS c FROM stock_batches
        WHERE branch_id = ? AND qty > 0 AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`, b.id)).c;
      const closedToday = await get('SELECT 1 FROM cash_closings WHERE branch_id = ? AND date = CURRENT_DATE', b.id);
      const notifyOnce = async (type, title, message) => {
        const dup = await get(`SELECT 1 FROM notifications WHERE branch_id = ? AND type = ? AND title = ? AND created_at::date = CURRENT_DATE`,
          b.id, type, title);
        if (!dup) {
          await run('INSERT INTO notifications (branch_id, type, title, message) VALUES (?,?,?,?)', b.id, type, title, message);
        }
      };
      if (low > 0) await notifyOnce('stock', 'Low stock reminder', `${low} medicine(s) are at or below minimum stock in ${b.name}.`);
      if (expiring > 0) await notifyOnce('expiry', 'Expiry reminder', `${expiring} batch(es) expire within 30 days in ${b.name}.`);
      const hour = new Date().getHours();
      if (hour >= 20 && !closedToday) await notifyOnce('accounts', 'Cash closing pending', `Daily cash closing for ${b.name} has not been done yet.`);
    }
  } catch (e) {
    console.error('Scheduled check failed:', e.message);
  }
}
dailyChecks();
setInterval(dailyChecks, 60 * 60 * 1000);
