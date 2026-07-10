import React, { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Tabs, Modal, Field, Badge, useToast, ExportBtn } from '../ui.jsx';

export default function Staff() {
  const { user } = useAuth();
  const tabs = [];
  if (can(user, 'staff.manage')) tabs.push({ key: 'users', label: '👤 Users & Roles' });
  if (can(user, 'tasks.view')) tabs.push({ key: 'tasks', label: '📋 Tasks' });
  if (can(user, 'attendance.self', 'attendance.manage')) tabs.push({ key: 'attendance', label: '🕐 Attendance' });
  if (can(user, 'delivery.view')) tabs.push({ key: 'deliveries', label: '🛵 Deliveries' });
  if (can(user, 'staff.manage', 'tasks.manage')) tabs.push({ key: 'announce', label: '📢 Announcements' });
  const [tab, setTab] = useState(tabs[0]?.key);
  return (
    <div>
      <Tabs active={tab} onChange={setTab} tabs={tabs} />
      {tab === 'users' && <Users />}
      {tab === 'tasks' && <Tasks />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'deliveries' && <Deliveries />}
      {tab === 'announce' && <Announce />}
    </div>
  );
}

function Users() {
  const { user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState({ users: [], roles: [] });
  const [edit, setEdit] = useState(null);
  const { branches } = useBranch();

  const load = () => api('/admin/users').then(setD).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, []);

  return (
    <Card>
      <div className="toolbar">
        <div className="spacer" />
        <ExportBtn name="staff-users" rows={d.users} columns={[
          { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' }, { key: 'role', label: 'Role' },
          { key: 'branch_name', label: 'Branch' },
          { key: 'max_discount_percent', label: 'Max disc %' }, { key: 'active', label: 'Active' },
        ]} />
        <button className="btn" onClick={() => setEdit({})}>+ Add User</button>
      </div>
      <Table columns={[
        { key: 'name', label: 'Name', render: r => <b>{r.name}</b> },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'role', label: 'Role', render: r => <Badge color="blue">{r.role.replace(/_/g, ' ')}</Badge> },
        { key: 'branch_name', label: 'Branch', render: r => r.branch_name || <span className="muted">All branches</span> },
        { key: 'active', label: 'Status', render: r => <Badge color={r.active ? 'green' : 'red'}>{r.active ? 'active' : 'disabled'}</Badge> },
        { label: '', render: r => <button className="btn ghost sm" onClick={() => setEdit(r)}>Edit</button> },
      ]} rows={d.users} />
      {edit && <UserModal u={edit} roles={d.roles} branches={branches} me={user} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Card>
  );
}

function UserModal({ u, roles, branches, me, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: u.name || '', email: u.email || '', phone: u.phone || '', role: u.role || 'billing_staff',
    branch_id: u.branch_id || '', password: '', active: u.active ?? 1,
    extra_branches: (() => { try { return JSON.parse(u.extra_branches || '[]'); } catch { return []; } })(),
    max_discount_percent: u.max_discount_percent ?? '',
  });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const toggleExtra = id => setF(x => ({
    ...x,
    extra_branches: x.extra_branches.includes(id)
      ? x.extra_branches.filter(b => b !== id)
      : [...x.extra_branches, id],
  }));
  const save = async () => {
    try {
      const body = {
        ...f, branch_id: f.branch_id ? Number(f.branch_id) : null, active: Number(f.active),
        max_discount_percent: f.max_discount_percent === '' ? null : Number(f.max_discount_percent),
      };
      if (!body.password) delete body.password;
      if (u.id) await api(`/admin/users/${u.id}`, { method: 'PUT', body });
      else await api('/admin/users', { method: 'POST', body });
      toast('User saved', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  const del = async () => {
    if (!confirm(`Delete user ${u.name}? If they have billing history the account is deactivated instead.`)) return;
    try {
      const r = await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      toast(r.message || 'User deleted', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={u.id ? `Edit ${u.name}` : 'Add user'} onClose={onClose} footer={
      <>{u.id && u.id !== me.id && <button className="btn red" onClick={del}>Delete</button>}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn green" onClick={save} disabled={!f.name || !f.email || (!u.id && !f.password)}>Save</button></>
    }>
      <div className="form-row">
        <Field label="Name *" value={f.name} onChange={set('name')} />
        <Field label="Email *" type="email" value={f.email} onChange={set('email')} disabled={!!u.id} />
      </div>
      <div className="form-row">
        <Field label="Phone" value={f.phone} onChange={set('phone')} />
        <Field label={u.id ? 'Reset password (optional)' : 'Password *'} type="password" value={f.password} onChange={set('password')} />
      </div>
      <div className="form-row">
        <Field label="Role">
          <select value={f.role} onChange={set('role')}>
            {roles.filter(r => me.role === 'super_admin' || r !== 'super_admin').map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <Field label="Primary branch">
          <select value={f.branch_id} onChange={set('branch_id')} disabled={me.role !== 'super_admin'}>
            <option value="">All branches (owner/auditor)</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={f.active} onChange={set('active')}>
            <option value={1}>Active</option><option value={0}>Disabled</option>
          </select>
        </Field>
      </div>
      {me.role === 'super_admin' && f.branch_id && (
        <Field label="Additional branches (user can switch between assigned branches)">
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {branches.filter(b => b.id !== Number(f.branch_id)).map(b => (
              <label key={b.id} className="checkbox-row" style={{ marginBottom: 0 }}>
                <input type="checkbox" checked={f.extra_branches.includes(b.id)} onChange={() => toggleExtra(b.id)} />
                {b.name}
              </label>
            ))}
          </div>
        </Field>
      )}
      <div className="form-row">
        <Field label="Max discount % without approval (blank = default 10%)" type="number" min="0" max="100"
          value={f.max_discount_percent} onChange={set('max_discount_percent')}
          placeholder="e.g. 5" />
      </div>
      <div className="muted">
        Discounts above this limit ask for manager approval at billing.
        Role permissions can be customised in Settings → Role Permissions.
      </div>
    </Modal>
  );
}

function Tasks() {
  const { user } = useAuth();
  const { branchId, branches } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [users, setUsers] = useState([]);

  const load = () => api('/staff/tasks', { params: { branch_id: branchId } }).then(d => setRows(d.tasks)).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, [branchId]);
  useEffect(() => {
    if (can(user, 'tasks.manage')) api('/admin/users').then(d => setUsers(d.users.filter(x => x.active)));
  }, []);

  const setStatus = async (t, status) => {
    try { await api(`/staff/tasks/${t.id}`, { method: 'PUT', body: { status } }); load(); }
    catch (e) { toast(e.message, 'red'); }
  };

  return (
    <Card>
      <div className="toolbar">
        <div className="spacer" />
        <ExportBtn name="tasks" rows={rows} columns={[
          { key: 'title', label: 'Task' }, { key: 'assigned_to_name', label: 'Assigned to' },
          { key: 'branch_name', label: 'Branch' }, { key: 'due_date', label: 'Due' },
          { key: 'status', label: 'Status' },
        ]} />
        {can(user, 'tasks.manage') && <button className="btn" onClick={() => setShow(true)}>+ New Task</button>}
      </div>
      <Table columns={[
        { key: 'title', label: 'Task', render: r => <><b>{r.title}</b><div className="muted">{r.description}</div></> },
        { key: 'assigned_to_name', label: 'Assigned to' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'due_date', label: 'Due' },
        { key: 'status', label: 'Status', render: r => <Badge>{r.status.replace(/_/g, ' ')}</Badge> },
        {
          label: '', render: r => r.status !== 'done' && (
            <div style={{ display: 'flex', gap: 6 }}>
              {r.status === 'pending' && <button className="btn ghost sm" onClick={() => setStatus(r, 'in_progress')}>Start</button>}
              <button className="btn green sm" onClick={() => setStatus(r, 'done')}>Done</button>
            </div>
          ),
        },
      ]} rows={rows} />
      {show && <TaskModal users={users} branches={branches} isSuperAdmin={user.role === 'super_admin'} onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />}
    </Card>
  );
}

function TaskModal({ users, branches, isSuperAdmin, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', assigned_to: '', due_date: '', branch_id: '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    try {
      await api('/staff/tasks', { method: 'POST', body: { ...f, assigned_to: f.assigned_to ? Number(f.assigned_to) : null, branch_id: f.branch_id ? Number(f.branch_id) : null } });
      toast('Task created', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title="New task" onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save} disabled={!f.title}>Create</button></>
    }>
      <Field label="Title *" value={f.title} onChange={set('title')} />
      <Field label="Description" value={f.description} onChange={set('description')} />
      <div className="form-row">
        <Field label="Assign to">
          <select value={f.assigned_to} onChange={set('assigned_to')}>
            <option value="">— unassigned —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role.replace(/_/g, ' ')})</option>)}
          </select>
        </Field>
        <Field label="Due date" type="date" value={f.due_date} onChange={set('due_date')} />
      </div>
      {isSuperAdmin && (
        <Field label="Branch">
          <select value={f.branch_id} onChange={set('branch_id')}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

function Attendance() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [mine, setMine] = useState(null);
  const [rows, setRows] = useState([]);

  const load = () => {
    api('/staff/attendance/today').then(d => setMine(d.attendance)).catch(() => {});
    api('/staff/attendance', { params: { branch_id: branchId } }).then(d => setRows(d.attendance)).catch(e => toast(e.message, 'red'));
  };
  useEffect(() => { load(); }, [branchId]);

  const mark = async which => {
    try {
      await api(`/staff/attendance/${which}`, { method: 'POST', body: { method: 'web' } });
      toast(which === 'check-in' ? 'Checked in ✓' : 'Checked out ✓', 'green'); load();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card title="My attendance today">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn green" disabled={!!mine?.check_in} onClick={() => mark('check-in')}>✅ Check In</button>
          <button className="btn orange" disabled={!mine?.check_in || !!mine?.check_out} onClick={() => mark('check-out')}>🕐 Check Out</button>
          <span className="muted">
            {mine?.check_in ? `In: ${mine.check_in}` : 'Not checked in yet'} {mine?.check_out ? ` · Out: ${mine.check_out}` : ''}
          </span>
        </div>
      </Card>
      <Card title="Attendance log (this month)"
        actions={<ExportBtn name="attendance" rows={rows} columns={[
          { key: 'date', label: 'Date' }, { key: 'user_name', label: 'Staff' },
          { key: 'role', label: 'Role' }, { key: 'branch_name', label: 'Branch' },
          { key: 'check_in', label: 'In' }, { key: 'check_out', label: 'Out' },
          { key: 'method', label: 'Via' },
        ]} />}>
        <Table columns={[
          { key: 'date', label: 'Date' },
          { key: 'user_name', label: 'Staff' },
          { key: 'role', label: 'Role', render: r => r.role?.replace(/_/g, ' ') },
          { key: 'branch_name', label: 'Branch' },
          { key: 'check_in', label: 'In' },
          { key: 'check_out', label: 'Out', render: r => r.check_out || <Badge color="orange">on duty</Badge> },
          { key: 'method', label: 'Via' },
        ]} rows={rows} keyFn={r => r.id} />
      </Card>
    </div>
  );
}

function Deliveries() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const load = () => api('/sales/deliveries/list', { params: { branch_id: branchId } })
    .then(d => setRows(d.deliveries)).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, [branchId]);

  const update = async (r, status) => {
    try {
      await api(`/sales/${r.id}/delivery`, { method: 'POST', body: { status } });
      toast(`Delivery marked ${status.replace(/_/g, ' ')}`, 'green'); load();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <Card title="Home deliveries"
      actions={<ExportBtn name="deliveries" rows={rows} columns={[
        { key: 'invoice_no', label: 'Invoice' }, { key: 'customer_name', label: 'Customer' },
        { key: 'customer_phone', label: 'Phone' }, { key: 'delivery_address', label: 'Address' },
        { key: 'total', label: 'Amount' }, { key: 'delivery_staff_name', label: 'Rider' },
        { key: 'delivery_status', label: 'Status' },
      ]} />}>
      <Table columns={[
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'customer_name', label: 'Customer', render: r => <><b>{r.customer_name || 'Walk-in'}</b><div className="muted">{r.customer_phone}</div></> },
        { key: 'delivery_address', label: 'Address' },
        { key: 'total', label: 'Amount', num: true, render: r => fmt(r.total) },
        { key: 'delivery_staff_name', label: 'Rider' },
        { key: 'delivery_status', label: 'Status', render: r => <Badge>{r.delivery_status.replace(/_/g, ' ')}</Badge> },
        {
          label: '', render: r => can(user, 'delivery.update') && r.delivery_status !== 'delivered' && (
            <div style={{ display: 'flex', gap: 6 }}>
              {r.delivery_status === 'pending' && <button className="btn sm" onClick={() => update(r, 'out_for_delivery')}>Pick up</button>}
              <button className="btn green sm" onClick={() => update(r, 'delivered')}>Delivered</button>
              <button className="btn red sm" onClick={() => update(r, 'failed')}>Failed</button>
            </div>
          ),
        },
      ]} rows={rows} empty="No deliveries — bills with a delivery address will appear here" />
    </Card>
  );
}

function Announce() {
  const { user } = useAuth();
  const { branches } = useBranch();
  const toast = useToast();
  const [f, setF] = useState({ title: '', message: '', branch_id: '', role: '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const send = async () => {
    try {
      await api('/staff/notifications/broadcast', {
        method: 'POST',
        body: { ...f, branch_id: f.branch_id ? Number(f.branch_id) : null, role: f.role || null },
      });
      toast('Announcement sent to staff in real time ✓', 'green');
      setF({ title: '', message: '', branch_id: '', role: '' });
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Card title="Send announcement to staff (appears instantly in web & mobile app)">
      <Field label="Title *" value={f.title} onChange={set('title')} placeholder="e.g. Stock audit tomorrow 9 AM" />
      <Field label="Message" value={f.message} onChange={set('message')} />
      <div className="form-row">
        {user.role === 'super_admin' && (
          <Field label="Branch">
            <select value={f.branch_id} onChange={set('branch_id')}>
              <option value="">All branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Only role (optional)">
          <select value={f.role} onChange={set('role')}>
            <option value="">All roles</option>
            {['branch_admin', 'branch_manager', 'pharmacist', 'billing_staff', 'inventory_staff', 'accountant', 'delivery_staff'].map(r => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </Field>
      </div>
      <button className="btn" onClick={send} disabled={!f.title}>📢 Send</button>
    </Card>
  );
}
