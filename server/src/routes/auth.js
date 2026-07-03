import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { all, get, run } from '../db.js';
import { authenticate, signToken, permissionsForUser, allowedBranchIds } from '../auth.js';
import { audit } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function deviceFrom(ua = '') {
  if (/RSGroupStaffApp/i.test(ua)) return 'Staff Mobile App';
  if (/mobile|android|iphone/i.test(ua)) return 'Mobile Browser';
  if (/postman|curl|axios|node/i.test(ua)) return 'API Client';
  return 'Desktop Browser';
}

router.post('/login', wrap(async (req, res) => {
  const { email, password, branch_code } = req.body || {};
  const ua = req.headers['user-agent'] || '';
  const user = await get('SELECT * FROM users WHERE lower(email) = lower(?)', String(email || '').trim());
  const fail = async (msg) => {
    await run('INSERT INTO login_history (user_id, email, ip, user_agent, device, success) VALUES (?,?,?,?,?,0)',
      user?.id || null, email || '', req.ip, ua, deviceFrom(ua));
    return res.status(401).json({ error: msg });
  };
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return fail('Invalid email or password');
  if (!user.active) return fail('Your account is disabled. Contact the administrator.');

  if (branch_code) {
    const branch = await get('SELECT * FROM branches WHERE code = ? AND active = 1', branch_code.trim().toUpperCase());
    if (!branch) return fail('Invalid branch code');
    const allowedForLogin = allowedBranchIds(user);
    if (allowedForLogin && !allowedForLogin.includes(branch.id)) {
      return fail('You are not assigned to this branch');
    }
  }

  const sessionId = crypto.randomUUID();
  await run('INSERT INTO sessions (id, user_id, ip, user_agent, device) VALUES (?,?,?,?,?)',
    sessionId, user.id, req.ip, ua, deviceFrom(ua));
  await run('INSERT INTO login_history (user_id, email, ip, user_agent, device, success) VALUES (?,?,?,?,?,1)',
    user.id, user.email, req.ip, ua, deviceFrom(ua));

  const token = signToken(user, sessionId);
  const branch = user.branch_id ? await get('SELECT id, code, name FROM branches WHERE id = ?', user.branch_id) : null;
  const allowed = allowedBranchIds(user);
  const branches = allowed
    ? await all(`SELECT id, code, name FROM branches WHERE active = 1 AND id IN (${allowed.map(Number).join(',') || 0}) ORDER BY id`)
    : [];
  const perms = await permissionsForUser(user);
  delete user.password_hash; delete user.reset_token; delete user.reset_token_expires;
  res.json({ token, user: { ...user, perms, branch, branches } });
}));

router.post('/forgot-password', wrap(async (req, res) => {
  const { email } = req.body || {};
  const user = await get('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1', String(email || '').trim());
  // Always respond success to avoid account enumeration
  if (!user) return res.json({ ok: true, message: 'If the account exists, a reset code has been generated.' });
  const token = String(crypto.randomInt(100000, 999999));
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await run('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', token, expires, user.id);
  // In production this would be sent by SMS/email. Demo mode returns it so the flow is fully testable.
  res.json({ ok: true, message: 'Reset code generated. (Demo mode: code shown here; in production it is sent via SMS/email.)', demo_reset_code: token });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const { email, code, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = await get('SELECT * FROM users WHERE lower(email) = lower(?)', String(email || '').trim());
  if (!user || !user.reset_token || user.reset_token !== String(code || '').trim()
    || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired reset code' });
  }
  await run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
    bcrypt.hashSync(new_password, 10), user.id);
  await run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', user.id);
  res.json({ ok: true, message: 'Password updated. Please login.' });
}));

router.use(authenticate);

router.get('/me', wrap(async (req, res) => {
  const branch = req.user.branch_id ? await get('SELECT id, code, name FROM branches WHERE id = ?', req.user.branch_id) : null;
  const allowed = allowedBranchIds(req.user);
  const branches = allowed
    ? await all(`SELECT id, code, name FROM branches WHERE active = 1 AND id IN (${allowed.map(Number).join(',') || 0}) ORDER BY id`)
    : [];
  res.json({ user: { ...req.user, branch, branches } });
}));

router.post('/change-password', wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = await get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(new_password, 10), user.id);
  audit(req, 'change_password', 'users', user.id);
  res.json({ ok: true });
}));

router.post('/logout', wrap(async (req, res) => {
  await run('UPDATE sessions SET revoked = 1 WHERE id = ?', req.sessionId);
  res.json({ ok: true });
}));

router.get('/sessions', wrap(async (req, res) => {
  const rows = await all(`SELECT id, ip, device, user_agent, created_at, last_seen, revoked
                          FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 30`, req.user.id);
  res.json({ sessions: rows, current: req.sessionId });
}));

router.post('/sessions/:id/revoke', wrap(async (req, res) => {
  await run('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
}));

router.get('/login-history', wrap(async (req, res) => {
  const isAdmin = ['super_admin', 'branch_admin'].includes(req.user.role);
  const rows = isAdmin
    ? await all(`SELECT lh.*, u.name AS user_name FROM login_history lh LEFT JOIN users u ON u.id = lh.user_id
                 ORDER BY lh.created_at DESC LIMIT 200`)
    : await all('SELECT * FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', req.user.id);
  res.json({ history: rows });
}));

export default router;
