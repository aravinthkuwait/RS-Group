import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run, insert, tx } from '../db.js';
import { requirePermission, ROLES, ALL_PERMISSIONS } from '../auth.js';
import { audit, getSetting, setSetting } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Branches ----------------
router.get('/branches', wrap(async (req, res) => {
  // Every logged-in user can list branches (needed for pickers); management is gated below.
  res.json({ branches: await all('SELECT * FROM branches ORDER BY id') });
}));

router.post('/branches', requirePermission('branches.manage'), wrap(async (req, res) => {
  const { code, name, address = '', city = '', phone = '', email = '', gstin = '', drug_license = '' } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'Branch code and name are required' });
  try {
    const id = await insert(`INSERT INTO branches (code, name, address, city, phone, email, gstin, drug_license)
      VALUES (?,?,?,?,?,?,?,?)`, code.trim().toUpperCase(), name.trim(), address, city, phone, email, gstin, drug_license);
    audit(req, 'create', 'branches', id, name);
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('duplicate') ? 'Branch code already exists' : e.message });
  }
}));

router.put('/branches/:id', requirePermission('branches.manage'), wrap(async (req, res) => {
  const { name, address, city, phone, email, gstin, drug_license, active } = req.body || {};
  await run(`UPDATE branches SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city),
    phone=COALESCE(?,phone), email=COALESCE(?,email), gstin=COALESCE(?,gstin),
    drug_license=COALESCE(?,drug_license), active=COALESCE(?,active) WHERE id=?`,
    name, address, city, phone, email, gstin, drug_license, active, req.params.id);
  audit(req, 'update', 'branches', Number(req.params.id));
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
    u.extra_permissions, u.denied_permissions, b.name AS branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.id`);
  if (!['super_admin', 'auditor'].includes(req.user.role)) {
    rows = rows.filter(u => u.branch_id === req.user.branch_id);
  }
  res.json({ users: rows, roles: ROLES, permissions: ALL_PERMISSIONS });
}));

router.post('/users', requirePermission('staff.manage'), wrap(async (req, res) => {
  const { name, email, phone = '', password, role, branch_id } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Name, email, password and role are required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'super_admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the owner can create super admin accounts' });
  const bid = req.user.role === 'super_admin' ? (branch_id || null) : req.user.branch_id;
  try {
    const id = await insert(`INSERT INTO users (name, email, phone, password_hash, role, branch_id)
      VALUES (?,?,?,?,?,?)`, name.trim(), email.trim().toLowerCase(), phone, bcrypt.hashSync(password, 10), role, bid);
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
  const { name, phone, role, branch_id, active, password, extra_permissions, denied_permissions } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  await run(`UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), role=COALESCE(?,role),
    branch_id=COALESCE(?,branch_id), active=COALESCE(?,active),
    extra_permissions=COALESCE(?,extra_permissions), denied_permissions=COALESCE(?,denied_permissions) WHERE id=?`,
    name, phone, role,
    req.user.role === 'super_admin' ? branch_id : null,
    active,
    extra_permissions ? JSON.stringify(extra_permissions) : null,
    denied_permissions ? JSON.stringify(denied_permissions) : null,
    req.params.id);
  if (password) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), req.params.id);
    await run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', req.params.id);
  }
  if (active === 0) await run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', req.params.id);
  audit(req, 'update', 'users', Number(req.params.id));
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
