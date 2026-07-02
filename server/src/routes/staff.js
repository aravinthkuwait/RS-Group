import { Router } from 'express';
import { all, get, run, insert } from '../db.js';
import { requirePermission, scopeBranch } from '../auth.js';
import { audit, notify, sseHandler, today } from '../util.js';

const router = Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------- Attendance ----------------
router.get('/attendance/today', requirePermission('attendance.self'), wrap(async (req, res) => {
  const row = await get('SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?', req.user.id, today());
  res.json({ attendance: row || null });
}));

router.post('/attendance/check-in', requirePermission('attendance.self'), wrap(async (req, res) => {
  const time = new Date().toTimeString().slice(0, 5);
  const existing = await get('SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?', req.user.id, today());
  if (existing?.check_in) return res.status(400).json({ error: `Already checked in at ${existing.check_in}` });
  await run(`INSERT INTO staff_attendance (user_id, branch_id, date, check_in, method)
    VALUES (?,?,?,?,?) ON CONFLICT (user_id, date) DO UPDATE SET check_in = excluded.check_in`,
    req.user.id, req.user.branch_id, today(), time, req.body?.method || 'mobile');
  audit(req, 'check_in', 'staff_attendance');
  res.json({ ok: true, check_in: time });
}));

router.post('/attendance/check-out', requirePermission('attendance.self'), wrap(async (req, res) => {
  const time = new Date().toTimeString().slice(0, 5);
  const existing = await get('SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?', req.user.id, today());
  if (!existing?.check_in) return res.status(400).json({ error: 'Check in first' });
  await run('UPDATE staff_attendance SET check_out = ? WHERE id = ?', time, existing.id);
  audit(req, 'check_out', 'staff_attendance');
  res.json({ ok: true, check_out: time });
}));

router.get('/attendance', requirePermission('attendance.manage', 'attendance.self'), wrap(async (req, res) => {
  const canManage = req.user.perms.includes('attendance.manage') || req.user.role === 'super_admin';
  const branchId = scopeBranch(req);
  const { from = today().slice(0, 8) + '01', to = today() } = req.query;
  const where = ['a.date BETWEEN ? AND ?']; const params = [from, to];
  if (!canManage) { where.push('a.user_id = ?'); params.push(req.user.id); }
  else if (branchId) { where.push('a.branch_id = ?'); params.push(branchId); }
  const rows = await all(`SELECT a.*, u.name AS user_name, u.role, b.name AS branch_name
    FROM staff_attendance a JOIN users u ON u.id = a.user_id LEFT JOIN branches b ON b.id = a.branch_id
    WHERE ${where.join(' AND ')} ORDER BY a.date DESC, u.name LIMIT 500`, ...params);
  res.json({ attendance: rows });
}));

// ---------------- Tasks ----------------
router.get('/tasks', requirePermission('tasks.view'), wrap(async (req, res) => {
  const canManage = req.user.perms.includes('tasks.manage') || req.user.role === 'super_admin';
  const branchId = scopeBranch(req);
  const where = []; const params = [];
  if (!canManage) { where.push('(t.assigned_to = ? OR t.created_by = ?)'); params.push(req.user.id, req.user.id); }
  else if (branchId) { where.push('t.branch_id = ?'); params.push(branchId); }
  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  const rows = await all(`SELECT t.*, u.name AS assigned_to_name, cb.name AS created_by_name, b.name AS branch_name
    FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN users cb ON cb.id = t.created_by
    LEFT JOIN branches b ON b.id = t.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (t.status = 'done'), t.due_date NULLS LAST, t.id DESC LIMIT 200`, ...params);
  res.json({ tasks: rows });
}));

router.post('/tasks', requirePermission('tasks.manage'), wrap(async (req, res) => {
  const { title, description = '', assigned_to = null, due_date = null, branch_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  const bid = req.user.role === 'super_admin' ? (branch_id || null) : req.user.branch_id;
  const id = await insert(`INSERT INTO tasks (branch_id, assigned_to, title, description, due_date, created_by)
    VALUES (?,?,?,?,?,?)`, bid, assigned_to, title.trim(), description, due_date || null, req.user.id);
  if (assigned_to) {
    await notify({ user_id: assigned_to, type: 'task', title: 'New task assigned', message: title });
  }
  audit(req, 'create', 'tasks', id, title);
  res.json({ id });
}));

router.put('/tasks/:id', requirePermission('tasks.view'), wrap(async (req, res) => {
  const t = await get('SELECT * FROM tasks WHERE id = ?', req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const canManage = req.user.perms.includes('tasks.manage') || req.user.role === 'super_admin';
  if (!canManage && t.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not your task' });
  const { status, title, description, due_date, assigned_to } = req.body || {};
  await run(`UPDATE tasks SET status=COALESCE(?,status), title=COALESCE(?,title), description=COALESCE(?,description),
    due_date=COALESCE(?,due_date), assigned_to=COALESCE(?,assigned_to),
    completed_at = CASE WHEN ? = 'done' THEN now() ELSE completed_at END WHERE id=?`,
    status, canManage ? title : null, canManage ? description : null,
    canManage ? (due_date || null) : null, canManage ? assigned_to : null, status, req.params.id);
  audit(req, 'update', 'tasks', Number(req.params.id), status || '');
  res.json({ ok: true });
}));

// ---------------- Notifications ----------------
router.get('/notifications', wrap(async (req, res) => {
  const u = req.user;
  const rows = await all(`SELECT * FROM notifications
    WHERE (user_id = ? OR user_id IS NULL)
      AND (role IS NULL OR role = ?)
      AND (branch_id IS NULL OR branch_id = ? OR ? IN ('super_admin','auditor'))
    ORDER BY id DESC LIMIT 60`, u.id, u.role, u.branch_id || -1, u.role);
  res.json({ notifications: rows, unread: rows.filter(n => !n.read).length });
}));

router.post('/notifications/read', wrap(async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (ids.length) await run(`UPDATE notifications SET read = 1 WHERE id IN (${ids.join(',')})`);
  res.json({ ok: true });
}));

// Admin broadcast to staff
router.post('/notifications/broadcast', requirePermission('staff.manage', 'tasks.manage'), wrap(async (req, res) => {
  const { title, message = '', branch_id = null, role = null } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const bid = req.user.role === 'super_admin' ? branch_id : req.user.branch_id;
  await notify({ branch_id: bid, role, type: 'announcement', title, message });
  audit(req, 'broadcast', 'notifications', null, title);
  res.json({ ok: true });
}));

// Real-time stream (SSE)
router.get('/stream', sseHandler);

export default router;
