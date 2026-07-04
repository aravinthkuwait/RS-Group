import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run, insert, tx } from '../db.js';
import { requirePermission, ROLES, ALL_PERMISSIONS, canAccessBranch } from '../auth.js';
import { audit, auditDiff, getSetting, setSetting } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Branches ----------------
router.get('/branches', wrap(async (req, res) => {
  // Every logged-in user can list branches (needed for pickers); management is gated below.
  res.json({ branches: await all('SELECT * FROM branches ORDER BY id') });
}));

router.post('/branches', requirePermission('branches.manage'), wrap(async (req, res) => {
  const { code, name, address = '', city = '', phone = '', email = '', gstin = '', drug_license = '', manager = '' } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'Branch code and name are required' });
  try {
    const id = await insert(`INSERT INTO branches (code, name, address, city, phone, email, gstin, drug_license, manager)
      VALUES (?,?,?,?,?,?,?,?,?)`, code.trim().toUpperCase(), name.trim(), address, city, phone, email, gstin, drug_license, manager);
    audit(req, 'create', 'branches', id, name);
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('duplicate') ? 'Branch code already exists' : e.message });
  }
}));

router.put('/branches/:id', requirePermission('branches.manage'), wrap(async (req, res) => {
  const { name, address, city, phone, email, gstin, drug_license, manager, active } = req.body || {};
  const before = await get('SELECT * FROM branches WHERE id = ?', req.params.id);
  if (!before) return res.status(404).json({ error: 'Branch not found' });
  await run(`UPDATE branches SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city),
    phone=COALESCE(?,phone), email=COALESCE(?,email), gstin=COALESCE(?,gstin),
    drug_license=COALESCE(?,drug_license), manager=COALESCE(?,manager), active=COALESCE(?,active) WHERE id=?`,
    name, address, city, phone, email, gstin, drug_license, manager, active, req.params.id);
  auditDiff(req, 'branches', Number(req.params.id), before,
    { name, address, city, phone, email, gstin, drug_license, manager, active },
    ['name', 'address', 'city', 'phone', 'email', 'gstin', 'drug_license', 'manager', 'active']);
  res.json({ ok: true });
}));

router.delete('/branches/:id', requirePermission('branches.manage'), wrap(async (req, res) => {
  const hasData = await get('SELECT 1 FROM sales WHERE branch_id = ? LIMIT 1', req.params.id)
    || await get('SELECT 1 FROM stock_batches WHERE branch_id = ? LIMIT 1', req.params.id);
  if (hasData) {
    await run('UPDATE branches SET active = 0 WHERE id = ?', req.params.id);
    audit(req, 'deactivate', 'branches', Number(req.params.id));
    return res.json({ ok: true, deactivated: true, message: 'Branch has transaction history, so it was deactivated instead of deleted.' });
  }
  await run('DELETE FROM branches WHERE id = ?', req.params.id);
  audit(req, 'delete', 'branches', Number(req.params.id));
  res.json({ ok: true });
}));

// ---------------- Users ----------------
router.get('/users', requirePermission('staff.manage', 'tasks.manage'), wrap(async (req, res) => {
  let rows = await all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.branch_id, u.active, u.created_at,
    u.extra_permissions, u.denied_permissions, u.extra_branches, u.max_discount_percent, b.name AS branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.id`);
  if (!['super_admin', 'auditor'].includes(req.user.role)) {
    rows = rows.filter(u => u.branch_id === req.user.branch_id);
  }
  res.json({ users: rows, roles: ROLES, permissions: ALL_PERMISSIONS });
}));

router.post('/users', requirePermission('staff.manage'), wrap(async (req, res) => {
  const { name, email, phone = '', password, role, branch_id, extra_branches = [], max_discount_percent = null } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Name, email, password and role are required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'super_admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the owner can create super admin accounts' });
  const bid = req.user.role === 'super_admin' ? (branch_id || null) : req.user.branch_id;
  const extras = req.user.role === 'super_admin'
    ? [...new Set((extra_branches || []).map(Number).filter(b => b && b !== Number(bid)))]
    : [];
  try {
    const id = await insert(`INSERT INTO users (name, email, phone, password_hash, role, branch_id, extra_branches, max_discount_percent)
      VALUES (?,?,?,?,?,?,?,?)`, name.trim(), email.trim().toLowerCase(), phone, bcrypt.hashSync(password, 10), role, bid, JSON.stringify(extras),
      max_discount_percent === null || max_discount_percent === '' ? null : Number(max_discount_percent));
    audit(req, 'create', 'users', id, `${name} (${role})`);
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('duplicate') ? 'Email already registered' : e.message });
  }
}));

router.put('/users/:id', requirePermission('staff.manage'), wrap(async (req, res) => {
  const target = await get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (req.user.role !== 'super_admin') {
    if (target.branch_id !== req.user.branch_id) return res.status(403).json({ error: 'User belongs to another branch' });
    if (target.role === 'super_admin' || req.body.role === 'super_admin') return res.status(403).json({ error: 'Not allowed' });
  }
  const { name, phone, role, branch_id, active, password, extra_permissions, denied_permissions, extra_branches } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const extras = req.user.role === 'super_admin' && Array.isArray(extra_branches)
    ? JSON.stringify([...new Set(extra_branches.map(Number).filter(b => b && b !== Number(branch_id ?? target.branch_id)))])
    : null;
  await run(`UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), role=COALESCE(?,role),
    branch_id=COALESCE(?,branch_id), active=COALESCE(?,active),
    extra_permissions=COALESCE(?,extra_permissions), denied_permissions=COALESCE(?,denied_permissions),
    extra_branches=COALESCE(?,extra_branches) WHERE id=?`,
    name, phone, role,
    req.user.role === 'super_admin' ? branch_id : null,
    active,
    extra_permissions ? JSON.stringify(extra_permissions) : null,
    denied_permissions ? JSON.stringify(denied_permissions) : null,
    extras,
    req.params.id);
  if ('max_discount_percent' in (req.body || {})) {
    const v = req.body.max_discount_percent;
    await run('UPDATE users SET max_discount_percent = ? WHERE id = ?',
      v === null || v === '' ? null : Number(v), req.params.id);
  }
  if (password) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), req.params.id);
    await run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', req.params.id);
  }
  if (active === 0) await run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', req.params.id);
  auditDiff(req, 'users', Number(req.params.id), target,
    { name, phone, role, branch_id, active, extra_branches: extras, max_discount_percent: req.body?.max_discount_percent },
    ['name', 'phone', 'role', 'branch_id', 'active', 'extra_branches', 'max_discount_percent']);
  res.json({ ok: true });
}));

// Delete a user (falls back to deactivate when history references them)
router.delete('/users/:id', requirePermission('staff.manage'), wrap(async (req, res) => {
  const target = await get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  if (target.role === 'super_admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Not allowed' });
  if (req.user.role !== 'super_admin' && !canAccessBranch(req.user, target.branch_id)) {
    return res.status(403).json({ error: 'User belongs to another branch' });
  }
  const referenced = await get(
    `SELECT 1 FROM sales WHERE staff_id = ? OR delivery_staff_id = ?
     UNION SELECT 1 FROM purchases WHERE created_by = ?
     UNION SELECT 1 FROM audit_logs WHERE user_id = ? LIMIT 1`,
    target.id, target.id, target.id, target.id);
  if (referenced) {
    await run('UPDATE users SET active = 0 WHERE id = ?', target.id);
    await run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', target.id);
    audit(req, 'deactivate', 'users', target.id, `${target.name} has history; deactivated instead of deleted`);
    return res.json({ ok: true, deactivated: true, message: 'User has billing/history records, so the account was deactivated instead of deleted.' });
  }
  await run('DELETE FROM sessions WHERE user_id = ?', target.id);
  await run('DELETE FROM login_history WHERE user_id = ?', target.id);
  await run('DELETE FROM staff_attendance WHERE user_id = ?', target.id);
  await run('UPDATE tasks SET assigned_to = NULL WHERE assigned_to = ?', target.id);
  await run('UPDATE tasks SET created_by = NULL WHERE created_by = ?', target.id);
  await run('DELETE FROM users WHERE id = ?', target.id);
  audit(req, 'delete', 'users', target.id, target.name);
  res.json({ ok: true });
}));

// ---------------- Role permission matrix ----------------
router.get('/permissions', requirePermission('settings.manage', 'staff.manage'), wrap(async (req, res) => {
  const rows = await all('SELECT role, permission FROM permissions');
  const matrix = {};
  for (const role of ROLES) matrix[role] = role === 'super_admin' ? [...ALL_PERMISSIONS] : [];
  for (const r of rows) matrix[r.role]?.push(r.permission);
  res.json({ matrix, all_permissions: ALL_PERMISSIONS, roles: ROLES });
}));

router.put('/permissions/:role', requirePermission('settings.manage'), wrap(async (req, res) => {
  const { role } = req.params;
  if (!ROLES.includes(role) || role === 'super_admin') return res.status(400).json({ error: 'Invalid role' });
  const perms = (req.body.permissions || []).filter(p => ALL_PERMISSIONS.includes(p));
  await tx(async db => {
    await db.run('DELETE FROM permissions WHERE role = ?', role);
    for (const p of perms) await db.run('INSERT INTO permissions (role, permission) VALUES (?,?)', role, p);
  });
  audit(req, 'update_permissions', 'permissions', null, role);
  res.json({ ok: true });
}));

// ---------------- Settings ----------------
const SETTING_KEYS = ['company', 'invoice', 'gst_rates', 'payment_types', 'medicine_categories', 'expense_categories'];

router.get('/settings', wrap(async (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = await getSetting(k);
  res.json({ settings: out });
}));

router.put('/settings/:key', requirePermission('settings.manage'), wrap(async (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) return res.status(400).json({ error: 'Unknown setting' });
  await setSetting(req.params.key, req.body.value);
  audit(req, 'update', 'settings', null, req.params.key);
  res.json({ ok: true });
}));

// ---------------- Audit log ----------------
router.get('/audit-logs', requirePermission('audit.view', 'settings.manage'), wrap(async (req, res) => {
  const { limit = 200 } = req.query;
  const rows = await all(`SELECT a.*, u.name AS user_name, b.name AS branch_name
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN branches b ON b.id = a.branch_id
    ORDER BY a.id DESC LIMIT ?`, Math.min(Number(limit), 1000));
  res.json({ logs: rows });
}));

// ---------------- Factory reset: wipe demo/auto-created data ----------------
// Deletes ALL business data (branches, medicines, sales, customers, ...) so the
// shop can start fresh. Keeps: super admin accounts, role permissions, settings.
router.post('/factory-reset', requirePermission('settings.manage'), wrap(async (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the owner can reset the system' });
  const { password, confirm } = req.body || {};
  if (confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE in the confirmation box to proceed' });
  const me = await get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(password || '', me.password_hash)) {
    return res.status(400).json({ error: 'Your password is incorrect' });
  }
  const session = await get('SELECT * FROM sessions WHERE id = ?', req.sessionId);
  await tx(async db => {
    await db.run(`TRUNCATE return_items, returns, supplier_payments, payments, sale_items, sales, promotions,
      purchase_return_items, purchase_returns, purchase_items, purchases,
      stock_transfer_items, stock_transfers, stock_adjustments, stock_batches,
      expenses, cash_closings, staff_attendance, tasks, notifications, audit_logs,
      login_history, sessions, customers, medicines, suppliers
      RESTART IDENTITY CASCADE`);
    await db.run('UPDATE users SET branch_id = NULL');
    await db.run(`DELETE FROM users WHERE role <> 'super_admin'`);
    await db.run('DELETE FROM branches');
    await db.run('ALTER TABLE branches ALTER COLUMN id RESTART WITH 1');
    // Keep the owner logged in
    if (session) {
      await db.run('INSERT INTO sessions (id, user_id, ip, user_agent, device) VALUES (?,?,?,?,?)',
        session.id, session.user_id, session.ip, session.user_agent, session.device);
    }
    // Stop the server from re-seeding demo data on next restart
    await db.run(`INSERT INTO settings (key, value) VALUES ('demo_data_wiped', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify(new Date().toISOString()));
  });
  audit(req, 'factory_reset', 'settings', null, 'All demo/business data wiped for fresh start');
  res.json({ ok: true, message: 'All data deleted. Add your real branches, staff and medicines to begin.' });
}));

// ---------------- Usage & cost monitor ----------------
// Surfaces what actually drives Supabase/Railway cost: DB size by table, the
// big base64 file blobs, and the ever-growing log tables — with cleanup.
router.get('/usage', requirePermission('settings.manage'), wrap(async (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Usage & cost is visible to the owner (admin) only' });
  const dbSize = await get(`SELECT pg_database_size(current_database()) AS bytes`);

  // Size + estimated rows per table (biggest first)
  const tables = await all(`
    SELECT c.relname AS name,
      pg_total_relation_size(c.oid) AS bytes,
      pg_relation_size(c.oid) AS data_bytes,
      pg_total_relation_size(c.oid) - pg_relation_size(c.oid) AS index_toast_bytes,
      GREATEST(c.reltuples, 0)::bigint AS est_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'rsgroup' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC`);
  const totalTableBytes = tables.reduce((a, t) => a + Number(t.bytes), 0) || 1;
  const tableRows = tables.map(t => ({ ...t, pct: Math.round(Number(t.bytes) / totalTableBytes * 1000) / 10 }));

  // The heaviest hidden cost: base64 files stored inline in the DB
  const rx = await get(`SELECT COUNT(*) FILTER (WHERE prescription_file IS NOT NULL) AS count,
    COALESCE(SUM(length(prescription_file)),0) AS bytes FROM sales`);
  const inv = await get(`SELECT COUNT(*) FILTER (WHERE invoice_file IS NOT NULL) AS count,
    COALESCE(SUM(length(invoice_file)),0) AS bytes FROM purchases`);

  // Unbounded log tables — grow forever, safe to prune
  const growth = {};
  for (const t of ['audit_logs', 'notifications', 'login_history', 'sessions']) {
    growth[t] = await get(`SELECT COUNT(*) AS rows, MIN(created_at)::date AS oldest FROM ${t}`);
  }
  growth.sessions.stale = (await get(`SELECT COUNT(*) AS c FROM sessions WHERE revoked = 1 OR last_seen < now() - interval '7 days'`)).c;
  growth.notifications.read = (await get(`SELECT COUNT(*) AS c FROM notifications WHERE read = 1 AND created_at < now() - interval '30 days'`)).c;
  growth.login_history.old = (await get(`SELECT COUNT(*) AS c FROM login_history WHERE created_at < now() - interval '90 days'`)).c;

  // Activity load (proxy for Railway compute / egress)
  const activity = {
    bills_30d: (await get(`SELECT COUNT(*) AS c FROM sales WHERE created_at > now() - interval '30 days'`)).c,
    active_sessions: (await get(`SELECT COUNT(*) AS c FROM sessions WHERE revoked = 0 AND last_seen > now() - interval '1 day'`)).c,
  };

  // Recommendations — what to resolve, ranked
  const recs = [];
  const mb = b => Number(b) / 1048576;
  if (mb(rx.bytes) + mb(inv.bytes) > 20) recs.push({ level: 'high', text: `Prescription/invoice files use ${(mb(rx.bytes) + mb(inv.bytes)).toFixed(1)} MB stored inside the database (expensive storage + backup + egress). Consider moving them to object storage, or purge old ones.` });
  if (growth.audit_logs.rows > 50000) recs.push({ level: 'med', text: `Audit log has ${growth.audit_logs.rows} rows. Archive/prune entries older than a year.` });
  if (growth.login_history.old > 0) recs.push({ level: 'low', text: `${growth.login_history.old} login-history rows are older than 90 days — safe to prune.` });
  if (growth.sessions.stale > 0) recs.push({ level: 'low', text: `${growth.sessions.stale} stale/revoked sessions can be cleared.` });
  if (growth.notifications.read > 0) recs.push({ level: 'low', text: `${growth.notifications.read} read notifications older than 30 days can be cleared.` });
  if (!recs.length) recs.push({ level: 'ok', text: 'No cost hot-spots detected. Database footprint is lean.' });

  res.json({
    db_bytes: Number(dbSize.bytes),
    tables: tableRows,
    blobs: { prescriptions: { count: rx.count, bytes: Number(rx.bytes) }, invoices: { count: inv.count, bytes: Number(inv.bytes) } },
    growth, activity, recommendations: recs,
    providers: [
      { name: 'Supabase (database)', drivers: 'storage, egress, backups', url: 'https://supabase.com/dashboard/project/rpwndipzblvrbcdqzwdb/settings/billing' },
      { name: 'Railway (hosting)', drivers: 'CPU / RAM / network', url: 'https://railway.app/dashboard' },
      { name: 'Expo EAS (mobile builds)', drivers: 'build minutes', url: 'https://expo.dev/accounts/aravinthkuwait/settings/billing' },
    ],
  });
}));

// Prune a chosen growth source to reclaim space (owner only)
router.post('/usage/cleanup', requirePermission('settings.manage'), wrap(async (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the owner can run cleanup' });
  const { target } = req.body || {};
  let removed = 0, label = '';
  if (target === 'sessions') {
    removed = (await run(`DELETE FROM sessions WHERE revoked = 1 OR last_seen < now() - interval '7 days'`)).changes || 0;
    label = 'stale/revoked sessions';
  } else if (target === 'login_history') {
    removed = (await run(`DELETE FROM login_history WHERE created_at < now() - interval '90 days'`)).changes || 0;
    label = 'login history older than 90 days';
  } else if (target === 'notifications') {
    removed = (await run(`DELETE FROM notifications WHERE read = 1 AND created_at < now() - interval '30 days'`)).changes || 0;
    label = 'read notifications older than 30 days';
  } else if (target === 'audit_logs') {
    removed = (await run(`DELETE FROM audit_logs WHERE created_at < now() - interval '365 days'`)).changes || 0;
    label = 'audit entries older than 1 year';
  } else if (target === 'prescriptions') {
    removed = (await run(`UPDATE sales SET prescription_file = NULL WHERE prescription_file IS NOT NULL AND created_at < now() - interval '180 days'`)).changes || 0;
    label = 'prescription files older than 6 months';
  } else if (target === 'invoice_files') {
    removed = (await run(`UPDATE purchases SET invoice_file = NULL WHERE invoice_file IS NOT NULL AND invoice_date < now() - interval '180 days'`)).changes || 0;
    label = 'supplier invoice files older than 6 months';
  } else {
    return res.status(400).json({ error: 'Unknown cleanup target' });
  }
  audit(req, 'usage_cleanup', 'settings', null, `Cleared ${removed} ${label}`);
  res.json({ ok: true, removed, message: `Cleared ${removed} ${label}.` });
}));

// ---------------- Data export (JSON) ----------------
// Database-level backups are managed by Supabase (Dashboard → Database → Backups).
// This endpoint exports all business data as JSON for an extra, portable copy.
const EXPORT_TABLES = [
  'branches', 'users', 'permissions', 'medicines', 'suppliers', 'stock_batches',
  'purchases', 'purchase_items', 'purchase_returns', 'purchase_return_items', 'supplier_payments',
  'customers', 'sales', 'sale_items', 'returns', 'return_items', 'payments',
  'expenses', 'cash_closings', 'stock_transfers', 'stock_transfer_items', 'stock_adjustments',
  'staff_attendance', 'tasks', 'notifications', 'settings',
];

router.get('/backup', requirePermission('settings.manage'), wrap(async (req, res) => {
  const dump = { exported_at: new Date().toISOString(), system: 'RS Group Medical Shop Management', tables: {} };
  for (const t of EXPORT_TABLES) {
    const rows = await all(`SELECT * FROM ${t}`);
    // Never export password hashes or reset tokens
    dump.tables[t] = t === 'users'
      ? rows.map(({ password_hash, reset_token, reset_token_expires, ...rest }) => rest)
      : rows;
  }
  audit(req, 'backup', 'settings');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="rsgroup-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(dump, null, 1));
}));

export default router;
