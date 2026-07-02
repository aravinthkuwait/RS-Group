import { Router } from 'express';
import db from '../db.js';
import { requirePermission, scopeBranch } from '../auth.js';
import { audit, notify, sseHandler, today } from '../util.js';

const router = Router();

// ---------------- Attendance ----------------
router.get('/attendance/today', requirePermission('attendance.self'), (req, res) => {
  const row = db.prepare('SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?').get(req.user.id, today());
  res.json({ attendance: row || null });
});

router.post('/attendance/check-in', requirePermission('attendance.self'), (req, res) => {
  const time = new Date().toTimeString().slice(0, 5);
  const existing = db.prepare('SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?').get(req.user.id, today());
  if (existing?.check_in) return res.status(400).json({ error: `Already checked in at ${existing.check_in}` });
  db.prepare(`INSERT INTO staff_attendance (user_id, branch_id, date, check_in, method)
    VALUES (?,?,?,?,?) ON CONFLICT(user_id, date) DO UPDATE SET check_in = excluded.check_in`)
    .run(req.user.id, req.user.branch_id, today(), time, req.body?.method || 'mobile');
  audit(req, 'check_in', 'staff_attendance');
  res.json({ ok: true, check_in: time });
});

router.post('/attendance/check-out', requirePermission('attendance.self'), (req, res) => {
  const time = new Date().toTimeString().slice(0, 5);
  const existing = db.prepare('SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?').get(req.user.id, today());
  if (!existing?.check_in) return res.status(400).json({ error: 'Check in first' });
  db.prepare('UPDATE staff_attendance SET check_out = ? WHERE id = ?').run(time, existing.id);
  audit(req, 'check_out', 'staff_attendance');
  res.json({ ok: true, check_out: time });
});

router.get('/attendance', requirePermission('attendance.manage', 'attendance.self'), (req, res) => {
  const canManage = req.user.perms.includes('attendance.manage') || req.user.role === 'super_admin';
  const branchId = scopeBranch(req);
  const { from = today().slice(0, 8) + '01', to = today() } = req.query;
  const where = ['a.date BETWEEN ? AND ?']; const params = [from, to];
  if (!canManage) { where.push('a.user_id = ?'); params.push(req.user.id); }
  else if (branchId) { where.push('a.branch_id = ?'); params.push(branchId); }
  const rows = db.prepare(`SELECT a.*, u.name AS user_name, u.role, b.name AS branch_name
    FROM staff_attendance a JOIN users u ON u.id = a.user_id LEFT JOIN branches b ON b.id = a.branch_id
    WHERE ${where.join(' AND ')} ORDER BY a.date DESC, u.name LIMIT 500`).all(...params);
  res.json({ attendance: rows });
});

// ---------------- Tasks ----------------
router.get('/tasks', requirePermission('tasks.view'), (req, res) => {
  const canManage = req.user.perms.includes('tasks.manage') || req.user.role === 'super_admin';
  const branchId = scopeBranch(req);
  const where = []; const params = [];
  if (!canManage) { where.push('(t.assigned_to = ? OR t.created_by = ?)'); params.push(req.user.id, req.user.id); }
  else if (branchId) { where.push('t.branch_id = ?'); params.push(branchId); }
  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  const rows = db.prepare(`SELECT t.*, u.name AS assigned_to_name, cb.name AS created_by_name, b.name AS branch_name
    FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN users cb ON cb.id = t.created_by
    LEFT JOIN branches b ON b.id = t.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.status = 'done', t.due_date, t.id DESC LIMIT 200`).all(...params);
  res.json({ tasks: rows });
});

router.post('/tasks', requirePermission('tasks.manage'), (req, res) => {
  const { title, description = '', assigned_to = null, due_date = null, branch_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  const bid = req.user.role === 'super_admin' ? (branch_id || null) : req.user.branch_id;
  const info = db.prepare(`INSERT INTO tasks (branch_id, assigned_to, title, description, due_date, created_by)
    VALUES (?,?,?,?,?,?)`).run(bid, assigned_to, title.trim(), description, due_date, req.user.id);
  if (assigned_to) {
    notify({ user_id: assigned_to, type: 'task', title: 'New task assigned', message: title });
  }
  audit(req, 'create', 'tasks', info.lastInsertRowid, title);
  res.json({ id: info.lastInsertRowid });
});

router.put('/tasks/:id', requirePermission('tasks.view'), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const canManage = req.user.perms.includes('tasks.manage') || req.user.role === 'super_admin';
  if (!canManage && t.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not your task' });
  const { status, title, description, due_date, assigned_to } = req.body || {};
  db.prepare(`UPDATE tasks SET status=COALESCE(?,status), title=COALESCE(?,title), description=COALESCE(?,description),
    due_date=COALESCE(?,due_date), assigned_to=COALESCE(?,assigned_to),
    completed_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE completed_at END WHERE id=?`)
    .run(status, canManage ? title : null, canManage ? description : null,
      canManage ? due_date : null, canManage ? assigned_to : null, status, req.params.id);
  audit(req, 'update', 'tasks', Number(req.params.id), status || '');
  res.json({ ok: true });
});

// ---------------- Notifications ----------------
router.get('/notifications', (req, res) => {
  const u = req.user;
  const rows = db.prepare(`SELECT * FROM notifications
    WHERE (user_id = ? OR user_id IS NULL)
      AND (role IS NULL OR role = ?)
      AND (branch_id IS NULL OR branch_id = ? OR ? IN ('super_admin','auditor'))
    ORDER BY id DESC LIMIT 60`).all(u.id, u.role, u.branch_id || -1, u.role);
  res.json({ notifications: rows, unread: rows.filter(n => !n.read).length });
});

router.post('/notifications/read', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (ids.length) db.prepare(`UPDATE notifications SET read = 1 WHERE id IN (${ids.join(',')})`).run();
  res.json({ ok: true });
});

// Admin broadcast to staff
router.post('/notifications/broadcast', requirePermission('staff.manage', 'tasks.manage'), (req, res) => {
  const { title, message = '', branch_id = null, role = null } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const bid = req.user.role === 'super_admin' ? branch_id : req.user.branch_id;
  notify({ branch_id: bid, role, type: 'announcement', title, message });
  audit(req, 'broadcast', 'notifications', null, title);
  res.json({ ok: true });
});

// Real-time stream (SSE)
router.get('/stream', sseHandler);

export default router;
