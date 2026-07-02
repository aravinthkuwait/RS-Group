import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { requirePermission, ROLES, ALL_PERMISSIONS, permissionsForUser } from '../auth.js';
import { audit, getSetting, setSetting } from '../util.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------- Branches ----------------
router.get('/branches', (req, res) => {
  // Every logged-in user can list branches (needed for pickers); management is gated below.
  const rows = db.prepare('SELECT * FROM branches ORDER BY id').all();
  res.json({ branches: rows });
});

router.post('/branches', requirePermission('branches.manage'), (req, res) => {
  const { code, name, address = '', city = '', phone = '', email = '', gstin = '', drug_license = '' } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'Branch code and name are required' });
  try {
    const info = db.prepare(`INSERT INTO branches (code, name, address, city, phone, email, gstin, drug_license)
      VALUES (?,?,?,?,?,?,?,?)`).run(code.trim().toUpperCase(), name.trim(), address, city, phone, email, gstin, drug_license);
    audit(req, 'create', 'branches', info.lastInsertRowid, name);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Branch code already exists' : e.message });
  }
});

router.put('/branches/:id', requirePermission('branches.manage'), (req, res) => {
  const { name, address, city, phone, email, gstin, drug_license, active } = req.body || {};
  db.prepare(`UPDATE branches SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city),
    phone=COALESCE(?,phone), email=COALESCE(?,email), gstin=COALESCE(?,gstin),
    drug_license=COALESCE(?,drug_license), active=COALESCE(?,active) WHERE id=?`)
    .run(name, address, city, phone, email, gstin, drug_license, active, req.params.id);
  audit(req, 'update', 'branches', Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/branches/:id', requirePermission('branches.manage'), (req, res) => {
  const hasData = db.prepare('SELECT 1 FROM sales WHERE branch_id = ? LIMIT 1').get(req.params.id)
    || db.prepare('SELECT 1 FROM stock_batches WHERE branch_id = ? LIMIT 1').get(req.params.id);
  if (hasData) {
    db.prepare('UPDATE branches SET active = 0 WHERE id = ?').run(req.params.id);
    audit(req, 'deactivate', 'branches', Number(req.params.id));
    return res.json({ ok: true, deactivated: true, message: 'Branch has transaction history, so it was deactivated instead of deleted.' });
  }
  db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'branches', Number(req.params.id));
  res.json({ ok: true });
});

// ---------------- Users ----------------
router.get('/users', requirePermission('staff.manage', 'tasks.manage'), (req, res) => {
  let rows = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.branch_id, u.active, u.created_at,
    u.extra_permissions, u.denied_permissions, b.name AS branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.id`).all();
  if (!['super_admin', 'auditor'].includes(req.user.role)) {
    rows = rows.filter(u => u.branch_id === req.user.branch_id);
  }
  res.json({ users: rows, roles: ROLES, permissions: ALL_PERMISSIONS });
});

router.post('/users', requirePermission('staff.manage'), (req, res) => {
  const { name, email, phone = '', password, role, branch_id } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Name, email, password and role are required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'super_admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only the owner can create super admin accounts' });
  const bid = req.user.role === 'super_admin' ? (branch_id || null) : req.user.branch_id;
  try {
    const info = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, branch_id)
      VALUES (?,?,?,?,?,?)`).run(name.trim(), email.trim().toLowerCase(), phone, bcrypt.hashSync(password, 10), role, bid);
    audit(req, 'create', 'users', info.lastInsertRowid, `${name} (${role})`);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Email already registered' : e.message });
  }
});

router.put('/users/:id', requirePermission('staff.manage'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (req.user.role !== 'super_admin') {
    if (target.branch_id !== req.user.branch_id) return res.status(403).json({ error: 'User belongs to another branch' });
    if (target.role === 'super_admin' || req.body.role === 'super_admin') return res.status(403).json({ error: 'Not allowed' });
  }
  const { name, phone, role, branch_id, active, password, extra_permissions, denied_permissions } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare(`UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), role=COALESCE(?,role),
    branch_id=COALESCE(?,branch_id), active=COALESCE(?,active),
    extra_permissions=COALESCE(?,extra_permissions), denied_permissions=COALESCE(?,denied_permissions) WHERE id=?`)
    .run(name, phone, role,
      req.user.role === 'super_admin' ? branch_id : undefined,
      active,
      extra_permissions ? JSON.stringify(extra_permissions) : null,
      denied_permissions ? JSON.stringify(denied_permissions) : null,
      req.params.id);
  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(req.params.id);
  }
  if (active === 0) db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(req.params.id);
  audit(req, 'update', 'users', Number(req.params.id));
  res.json({ ok: true });
});

// ---------------- Role permission matrix ----------------
router.get('/permissions', requirePermission('settings.manage', 'staff.manage'), (req, res) => {
  const rows = db.prepare('SELECT role, permission FROM permissions').all();
  const matrix = {};
  for (const role of ROLES) matrix[role] = role === 'super_admin' ? [...ALL_PERMISSIONS] : [];
  for (const r of rows) matrix[r.role]?.push(r.permission);
  res.json({ matrix, all_permissions: ALL_PERMISSIONS, roles: ROLES });
});

router.put('/permissions/:role', requirePermission('settings.manage'), (req, res) => {
  const { role } = req.params;
  if (!ROLES.includes(role) || role === 'super_admin') return res.status(400).json({ error: 'Invalid role' });
  const perms = (req.body.permissions || []).filter(p => ALL_PERMISSIONS.includes(p));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM permissions WHERE role = ?').run(role);
    const ins = db.prepare('INSERT INTO permissions (role, permission) VALUES (?,?)');
    perms.forEach(p => ins.run(role, p));
  });
  tx();
  audit(req, 'update_permissions', 'permissions', null, role);
  res.json({ ok: true });
});

// ---------------- Settings ----------------
const SETTING_KEYS = ['company', 'invoice', 'gst_rates', 'payment_types', 'medicine_categories', 'expense_categories'];

router.get('/settings', (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  res.json({ settings: out });
});

router.put('/settings/:key', requirePermission('settings.manage'), (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) return res.status(400).json({ error: 'Unknown setting' });
  setSetting(req.params.key, req.body.value);
  audit(req, 'update', 'settings', null, req.params.key);
  res.json({ ok: true });
});

// ---------------- Audit log ----------------
router.get('/audit-logs', requirePermission('audit.view', 'settings.manage'), (req, res) => {
  const { limit = 200 } = req.query;
  const rows = db.prepare(`SELECT a.*, u.name AS user_name, b.name AS branch_name
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN branches b ON b.id = a.branch_id
    ORDER BY a.id DESC LIMIT ?`).all(Math.min(Number(limit), 1000));
  res.json({ logs: rows });
});

// ---------------- Backup / restore ----------------
router.get('/backup', requirePermission('settings.manage'), async (req, res) => {
  const dest = path.join(__dirname, '..', '..', 'data', `backup-${Date.now()}.db`);
  await db.backup(dest);
  audit(req, 'backup', 'settings');
  res.download(dest, `rsgroup-backup-${new Date().toISOString().slice(0, 10)}.db`, () => {
    fs.unlink(dest, () => {});
  });
});

export default router;
