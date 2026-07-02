import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db.js';
import { authenticate, signToken, permissionsForUser } from '../auth.js';
import { audit } from '../util.js';

const router = Router();

function deviceFrom(ua = '') {
  if (/RSGroupStaffApp/i.test(ua)) return 'Staff Mobile App';
  if (/mobile|android|iphone/i.test(ua)) return 'Mobile Browser';
  if (/postman|curl|axios|node/i.test(ua)) return 'API Client';
  return 'Desktop Browser';
}

router.post('/login', (req, res) => {
  const { email, password, branch_code } = req.body || {};
  const ua = req.headers['user-agent'] || '';
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim());
  const fail = (msg) => {
    db.prepare('INSERT INTO login_history (user_id, email, ip, user_agent, device, success) VALUES (?,?,?,?,?,0)')
      .run(user?.id || null, email || '', req.ip, ua, deviceFrom(ua));
    return res.status(401).json({ error: msg });
  };
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return fail('Invalid email or password');
  if (!user.active) return fail('Your account is disabled. Contact the administrator.');

  // Optional branch-code login (branch portal): verify the user belongs to that branch
  if (branch_code) {
    const branch = db.prepare('SELECT * FROM branches WHERE code = ? AND active = 1').get(branch_code.trim().toUpperCase());
    if (!branch) return fail('Invalid branch code');
    if (!['super_admin', 'auditor'].includes(user.role) && user.branch_id !== branch.id) {
      return fail('You are not assigned to this branch');
    }
  }

  const sessionId = crypto.randomUUID();
  db.prepare('INSERT INTO sessions (id, user_id, ip, user_agent, device) VALUES (?,?,?,?,?)')
    .run(sessionId, user.id, req.ip, ua, deviceFrom(ua));
  db.prepare('INSERT INTO login_history (user_id, email, ip, user_agent, device, success) VALUES (?,?,?,?,?,1)')
    .run(user.id, user.email, req.ip, ua, deviceFrom(ua));

  const token = signToken(user, sessionId);
  const branch = user.branch_id ? db.prepare('SELECT id, code, name FROM branches WHERE id = ?').get(user.branch_id) : null;
  delete user.password_hash; delete user.reset_token; delete user.reset_token_expires;
  res.json({ token, user: { ...user, perms: permissionsForUser(user), branch } });
});

router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1').get(String(email || '').trim());
  // Always respond success to avoid account enumeration
  if (!user) return res.json({ ok: true, message: 'If the account exists, a reset code has been generated.' });
  const token = String(crypto.randomInt(100000, 999999));
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);
  // In production this would be sent by SMS/email. Demo mode returns it so the flow is fully testable.
  res.json({ ok: true, message: 'Reset code generated. (Demo mode: code shown here; in production it is sent via SMS/email.)', demo_reset_code: token });
});

router.post('/reset-password', (req, res) => {
  const { email, code, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim());
  if (!user || !user.reset_token || user.reset_token !== String(code || '').trim()
    || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired reset code' });
  }
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), user.id);
  db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(user.id);
  res.json({ ok: true, message: 'Password updated. Please login.' });
});

router.use(authenticate);

router.get('/me', (req, res) => {
  const branch = req.user.branch_id ? db.prepare('SELECT id, code, name FROM branches WHERE id = ?').get(req.user.branch_id) : null;
  res.json({ user: { ...req.user, branch } });
});

router.post('/change-password', (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  audit(req, 'change_password', 'users', user.id);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.sessionId);
  res.json({ ok: true });
});

router.get('/sessions', (req, res) => {
  const rows = db.prepare(`SELECT id, ip, device, user_agent, created_at, last_seen, revoked
                           FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 30`).all(req.user.id);
  res.json({ sessions: rows, current: req.sessionId });
});

router.post('/sessions/:id/revoke', (req, res) => {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.get('/login-history', (req, res) => {
  const isAdmin = ['super_admin', 'branch_admin'].includes(req.user.role);
  const rows = isAdmin
    ? db.prepare(`SELECT lh.*, u.name AS user_name FROM login_history lh LEFT JOIN users u ON u.id = lh.user_id
                  ORDER BY lh.created_at DESC LIMIT 200`).all()
    : db.prepare('SELECT * FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ history: rows });
});

export default router;
