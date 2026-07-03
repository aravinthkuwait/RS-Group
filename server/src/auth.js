import jwt from 'jsonwebtoken';
import { all, get, run } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'rs-group-dev-secret-change-in-production';

export const ROLES = [
  'super_admin', 'branch_admin', 'branch_manager', 'pharmacist', 'billing_staff',
  'inventory_staff', 'accountant', 'delivery_staff', 'auditor',
];

export const ALL_PERMISSIONS = [
  'dashboard.view', 'dashboard.all_branches',
  'billing.create', 'billing.discount', 'billing.return', 'billing.cancel', 'billing.view',
  'inventory.view', 'inventory.edit', 'inventory.adjust', 'inventory.transfer',
  'purchases.view', 'purchases.manage', 'suppliers.manage',
  'customers.view', 'customers.manage',
  'expenses.view', 'expenses.manage', 'accounts.manage',
  'reports.view', 'reports.export',
  'staff.manage', 'branches.manage', 'settings.manage',
  'delivery.view', 'delivery.update',
  'tasks.view', 'tasks.manage',
  'attendance.self', 'attendance.manage',
  'audit.view',
];

// Default role -> permissions matrix (seeded into DB; editable by super admin)
export const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,
  branch_admin: ALL_PERMISSIONS.filter(p => !['branches.manage', 'dashboard.all_branches'].includes(p)),
  branch_manager: [
    'dashboard.view', 'billing.create', 'billing.discount', 'billing.return', 'billing.cancel', 'billing.view',
    'inventory.view', 'inventory.edit', 'inventory.adjust', 'inventory.transfer',
    'purchases.view', 'purchases.manage', 'suppliers.manage',
    'customers.view', 'customers.manage', 'expenses.view', 'expenses.manage', 'accounts.manage',
    'reports.view', 'reports.export', 'delivery.view', 'delivery.update',
    'tasks.view', 'tasks.manage', 'attendance.self', 'attendance.manage',
  ],
  pharmacist: [
    'dashboard.view', 'billing.create', 'billing.discount', 'billing.view', 'billing.return',
    'inventory.view', 'inventory.edit', 'inventory.adjust',
    'customers.view', 'customers.manage', 'purchases.view',
    'tasks.view', 'attendance.self',
  ],
  billing_staff: [
    'dashboard.view', 'billing.create', 'billing.view', 'billing.return',
    'inventory.view', 'customers.view', 'customers.manage',
    'tasks.view', 'attendance.self',
  ],
  inventory_staff: [
    'dashboard.view', 'inventory.view', 'inventory.edit', 'inventory.adjust', 'inventory.transfer',
    'purchases.view', 'purchases.manage', 'suppliers.manage',
    'tasks.view', 'attendance.self',
  ],
  accountant: [
    'dashboard.view', 'billing.view', 'expenses.view', 'expenses.manage', 'accounts.manage',
    'purchases.view', 'suppliers.manage', 'customers.view',
    'reports.view', 'reports.export', 'attendance.self', 'tasks.view',
  ],
  delivery_staff: [
    'delivery.view', 'delivery.update', 'customers.view', 'tasks.view', 'attendance.self',
  ],
  auditor: [
    'dashboard.view', 'dashboard.all_branches', 'billing.view', 'inventory.view',
    'purchases.view', 'customers.view', 'expenses.view',
    'reports.view', 'reports.export', 'audit.view',
  ],
};

export async function permissionsForUser(user) {
  const rolePerms = user.role === 'super_admin'
    ? [...ALL_PERMISSIONS]
    : (await all('SELECT permission FROM permissions WHERE role = ?', user.role)).map(r => r.permission);
  const extra = JSON.parse(user.extra_permissions || '[]');
  const denied = JSON.parse(user.denied_permissions || '[]');
  const set = new Set([...rolePerms, ...extra]);
  denied.forEach(p => set.delete(p));
  return [...set];
}

export function can(user, permission) {
  if (user.role === 'super_admin') return true;
  return (user.perms || []).includes(permission);
}

export function signToken(user, sessionId) {
  return jwt.sign({ uid: user.id, role: user.role, sid: sessionId }, JWT_SECRET, { expiresIn: '12h' });
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const user = await get('SELECT * FROM users WHERE id = ? AND active = 1', payload.uid);
    if (!user) return res.status(401).json({ error: 'Account not found or disabled' });
    const session = await get('SELECT * FROM sessions WHERE id = ?', payload.sid);
    if (!session || session.revoked) return res.status(401).json({ error: 'Session ended. Please login again.' });
    run('UPDATE sessions SET last_seen = now() WHERE id = ?', payload.sid).catch(() => {});
    user.perms = await permissionsForUser(user);
    delete user.password_hash;
    req.user = user;
    req.sessionId = payload.sid;
    next();
  } catch (e) {
    next(e);
  }
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (permissions.some(p => can(req.user, p))) return next();
    return res.status(403).json({ error: 'You do not have permission for this action' });
  };
}

// Branches a user may work in: primary branch + any extra assigned branches.
// null = all branches (owner / auditor).
export function allowedBranchIds(user) {
  if (user.role === 'super_admin' || user.role === 'auditor') return null;
  let extra = [];
  try { extra = JSON.parse(user.extra_branches || '[]'); } catch { /* legacy */ }
  return [...new Set([user.branch_id, ...extra.map(Number)].filter(Boolean))];
}

export function canAccessBranch(user, branchId) {
  const allowed = allowedBranchIds(user);
  return !allowed || allowed.includes(Number(branchId));
}

// Branch scoping for reads: honour a requested branch only if the user is
// assigned to it; otherwise fall back to their primary branch.
export function scopeBranch(req) {
  const requested = req.query.branch_id ? Number(req.query.branch_id) : null;
  const allowed = allowedBranchIds(req.user);
  if (!allowed) return requested; // owner/auditor: null = all
  if (requested && allowed.includes(requested)) return requested;
  return req.user.branch_id;
}

// For writes: resolve the branch a mutation applies to, enforcing assignment.
export function writeBranch(req, bodyBranchId) {
  const requested = bodyBranchId ? Number(bodyBranchId) : null;
  const allowed = allowedBranchIds(req.user);
  if (!allowed) return requested || req.user.branch_id;
  if (requested && allowed.includes(requested)) return requested;
  return req.user.branch_id;
}
