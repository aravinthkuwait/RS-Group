import React, { useEffect, useState } from 'react';
import { api, fileUrl } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Tabs, Modal, Field, Badge, useToast, ExportBtn } from '../ui.jsx';

export default function Settings() {
  const { user } = useAuth();
  const tabs = [{ key: 'profile', label: '🔐 My Account' }];
  if (can(user, 'settings.manage')) tabs.push({ key: 'company', label: '🏢 Company & Invoice' }, { key: 'lists', label: '🏷 Categories & Taxes' });
  if (can(user, 'branches.manage')) tabs.push({ key: 'branches', label: '🏪 Branches' });
  if (can(user, 'settings.manage')) tabs.push({ key: 'permissions', label: '🛡 Role Permissions' });
  if (can(user, 'audit.view', 'settings.manage')) tabs.push({ key: 'audit', label: '📜 Activity Log' });
  const [tab, setTab] = useState('profile');
  return (
    <div>
      <Tabs active={tab} onChange={setTab} tabs={tabs} />
      {tab === 'profile' && <MyAccount />}
      {tab === 'company' && <Company />}
      {tab === 'lists' && <Lists />}
      {tab === 'branches' && <Branches />}
      {tab === 'permissions' && <Permissions />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function MyAccount() {
  const { user } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [sessions, setSessions] = useState({ sessions: [], current: '' });
  const [history, setHistory] = useState([]);

  const load = () => {
    api('/auth/sessions').then(setSessions).catch(() => {});
    api('/auth/login-history').then(d => setHistory(d.history)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const changePw = async () => {
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      toast('Password changed ✓', 'green'); setPw({ current_password: '', new_password: '' });
    } catch (e) { toast(e.message, 'red'); }
  };
  const revoke = async id => {
    await api(`/auth/sessions/${id}/revoke`, { method: 'POST', body: {} }).catch(() => {});
    load();
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <Card title="Change password">
          <Field label="Current password" type="password" value={pw.current_password} onChange={e => setPw(p => ({ ...p, current_password: e.target.value }))} />
          <Field label="New password (min 6 chars)" type="password" value={pw.new_password} onChange={e => setPw(p => ({ ...p, new_password: e.target.value }))} />
          <button className="btn" onClick={changePw} disabled={!pw.current_password || pw.new_password.length < 6}>Update Password</button>
        </Card>
        <Card title="Active sessions & devices">
          <Table columns={[
            { key: 'device', label: 'Device' },
            { key: 'ip', label: 'IP' },
            { key: 'last_seen', label: 'Last active' },
            {
              label: '', render: r => r.id === sessions.current
                ? <Badge color="green">this device</Badge>
                : !r.revoked && <button className="btn red sm" onClick={() => revoke(r.id)}>Sign out</button>,
            },
          ]} rows={sessions.sessions.filter(s => !s.revoked)} keyFn={r => r.id} />
        </Card>
      </div>
      <Card title={['super_admin', 'branch_admin'].includes(user.role) ? 'Login history (all users)' : 'My login history'}
        actions={<ExportBtn name="login-history" rows={history} columns={[
          { key: 'created_at', label: 'Time' }, { key: 'user_name', label: 'User' },
          { key: 'email', label: 'Email' }, { key: 'device', label: 'Device' },
          { key: 'ip', label: 'IP' }, { key: 'success', label: 'Success' },
        ]} />}>
        <Table columns={[
          { key: 'created_at', label: 'Time' },
          ...(user.role === 'super_admin' || user.role === 'branch_admin' ? [{ key: 'user_name', label: 'User', render: r => r.user_name || r.email }] : []),
          { key: 'device', label: 'Device' },
          { key: 'ip', label: 'IP' },
          { key: 'success', label: 'Result', render: r => <Badge color={r.success ? 'green' : 'red'}>{r.success ? 'success' : 'failed'}</Badge> },
        ]} rows={history} keyFn={r => r.id} />
      </Card>
    </div>
  );
}

function Company() {
  const toast = useToast();
  const [s, setS] = useState(null);
  useEffect(() => { api('/admin/settings').then(d => setS(d.settings)); }, []);
  if (!s) return null;
  const save = async (key) => {
    try {
      await api(`/admin/settings/${key}`, { method: 'PUT', body: { value: s[key] } });
      toast('Settings saved', 'green');
    } catch (e) { toast(e.message, 'red'); }
  };
  const setC = (k, v) => setS(x => ({ ...x, company: { ...x.company, [k]: v } }));
  const setI = (k, v) => setS(x => ({ ...x, invoice: { ...x.invoice, [k]: v } }));
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', alignItems: 'start' }}>
      <Card title="Company profile (shown on invoices)">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
          <img src="/rs-group-logo.jpg" alt="logo" style={{ width: 72, borderRadius: 12, border: '1px solid var(--line)' }} />
          <div className="muted">RS Group logo is embedded on all PDF invoices and reports.</div>
        </div>
        {['name', 'division', 'address', 'phone', 'email', 'gstin', 'drug_license'].map(k => (
          <Field key={k} label={k.replace(/_/g, ' ').toUpperCase()} value={s.company?.[k] || ''} onChange={e => setC(k, e.target.value)} />
        ))}
        <button className="btn green" onClick={() => save('company')}>Save Company</button>
      </Card>
      <Card title="Invoice format">
        <Field label="Invoice heading note" value={s.invoice?.prefix_note || ''} onChange={e => setI('prefix_note', e.target.value)} />
        <Field label="Terms line" value={s.invoice?.terms || ''} onChange={e => setI('terms', e.target.value)} />
        <Field label="Footer message" value={s.invoice?.footer || ''} onChange={e => setI('footer', e.target.value)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={!!s.invoice?.show_savings} onChange={e => setI('show_savings', e.target.checked)} />
          Show "You saved ₹X" on bills
        </label>
        <button className="btn green" onClick={() => save('invoice')}>Save Invoice Settings</button>
        <hr style={{ margin: '18px 0', border: 'none', borderTop: '1px solid var(--line)' }} />
        <h4 style={{ marginBottom: 8 }}>Backup</h4>
        <a className="btn green" href={fileUrl('/admin/backup')}>⬇ Download full backend backup (JSON)</a>
        <div className="muted" style={{ marginTop: 8 }}>
          Downloads every table — branches, users, medicines, stock, bills, customers,
          expenses — as one file. Database-level backups &amp; point-in-time restore are
          also managed automatically by Supabase (Dashboard → Database → Backups).
        </div>
        <FreshStart />
      </Card>
    </div>
  );
}

function FreshStart() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  if (user.role !== 'super_admin') return null;

  const wipe = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/factory-reset', { method: 'POST', body: { password, confirm } });
      toast(r.message, 'green');
      setTimeout(() => window.location.assign('/'), 1200);
    } catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  };

  return (
    <>
      <hr style={{ margin: '18px 0', border: 'none', borderTop: '1px solid var(--line)' }} />
      <h4 style={{ marginBottom: 8, color: 'var(--red)' }}>Fresh start</h4>
      <button className="btn red" onClick={() => setOpen(true)}>🗑 Delete ALL demo data — start fresh</button>
      <div className="muted" style={{ marginTop: 8 }}>
        Removes every auto-created record: sample branches, staff, medicines, stock,
        bills, customers, suppliers, expenses. Keeps your owner login and settings.
      </div>
      {open && (
        <Modal title="⚠ Delete ALL data?" onClose={() => setOpen(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn red" disabled={busy || confirm !== 'DELETE' || !password} onClick={wipe}>
              {busy ? 'Deleting…' : 'Yes, delete everything'}
            </button>
          </>
        }>
          <div className="err-msg">
            This permanently deletes ALL branches, staff accounts, medicines, stock,
            bills, customers, suppliers and expenses. It cannot be undone.
            Download a backup first if you want to keep a copy.
          </div>
          <Field label="Your password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <Field label='Type DELETE to confirm' value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="DELETE" />
        </Modal>
      )}
    </>
  );
}

function Lists() {
  const toast = useToast();
  const [s, setS] = useState(null);
  useEffect(() => { api('/admin/settings').then(d => setS(d.settings)); }, []);
  if (!s) return null;
  const saveList = async (key, text) => {
    const value = text.split(',').map(x => x.trim()).filter(Boolean).map(v => key === 'gst_rates' ? Number(v) : v);
    try {
      await api(`/admin/settings/${key}`, { method: 'PUT', body: { value } });
      toast('Saved', 'green');
    } catch (e) { toast(e.message, 'red'); }
  };
  const ListEditor = ({ k, title }) => {
    const [text, setText] = useState((s[k] || []).join(', '));
    return (
      <Card title={title}>
        <Field label="Comma-separated values" value={text} onChange={e => setText(e.target.value)} />
        <button className="btn green sm" onClick={() => saveList(k, text)}>Save</button>
      </Card>
    );
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      <ListEditor k="medicine_categories" title="Medicine categories" />
      <ListEditor k="expense_categories" title="Expense categories" />
      <ListEditor k="gst_rates" title="GST rates (%)" />
      <ListEditor k="payment_types" title="Payment types" />
    </div>
  );
}

function Branches() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = () => api('/admin/branches').then(d => setRows(d.branches)).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, []);

  const del = async b => {
    if (!confirm(`Delete/deactivate branch ${b.name}?`)) return;
    try {
      const r = await api(`/admin/branches/${b.id}`, { method: 'DELETE' });
      toast(r.message || 'Branch removed', 'green'); load();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <Card>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn" onClick={() => setEdit({})}>+ Add Branch</button>
      </div>
      <Table columns={[
        { key: 'code', label: 'Code', render: r => <Badge color="blue">{r.code}</Badge> },
        { key: 'name', label: 'Name', render: r => <b>{r.name}</b> },
        { key: 'city', label: 'City' },
        { key: 'manager', label: 'Manager' },
        { key: 'phone', label: 'Phone' },
        { key: 'gstin', label: 'GSTIN' },
        { key: 'active', label: 'Status', render: r => <Badge color={r.active ? 'green' : 'red'}>{r.active ? 'active' : 'inactive'}</Badge> },
        {
          label: '', render: r => (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn ghost sm" onClick={() => setEdit(r)}>Edit</button>
              <button className="btn red sm" onClick={() => del(r)}>Delete</button>
            </div>
          ),
        },
      ]} rows={rows} />
      {edit && <BranchModal b={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Card>
  );
}

function BranchModal({ b, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    code: b.code || '', name: b.name || '', address: b.address || '', city: b.city || '',
    phone: b.phone || '', email: b.email || '', gstin: b.gstin || '', drug_license: b.drug_license || '',
    manager: b.manager || '', active: b.active ?? 1,
  });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    try {
      if (b.id) await api(`/admin/branches/${b.id}`, { method: 'PUT', body: { ...f, active: Number(f.active) } });
      else await api('/admin/branches', { method: 'POST', body: f });
      toast('Branch saved', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={b.id ? `Edit ${b.name}` : 'Add branch'} onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save} disabled={!f.code || !f.name}>Save</button></>
    }>
      <div className="form-row">
        <Field label="Branch code * (used in invoice numbers & branch login)" value={f.code} onChange={set('code')} disabled={!!b.id} placeholder="e.g. RSG-TRY" />
        <Field label="Name *" value={f.name} onChange={set('name')} />
      </div>
      <div className="form-row">
        <Field label="City" value={f.city} onChange={set('city')} />
        <Field label="Phone" value={f.phone} onChange={set('phone')} />
        <Field label="Email" value={f.email} onChange={set('email')} />
      </div>
      <div className="form-row">
        <Field label="GSTIN" value={f.gstin} onChange={set('gstin')} />
        <Field label="Drug license" value={f.drug_license} onChange={set('drug_license')} />
        <Field label="Branch manager" value={f.manager} onChange={set('manager')} />
        {b.id && (
          <Field label="Status">
            <select value={f.active} onChange={set('active')}><option value={1}>Active</option><option value={0}>Inactive</option></select>
          </Field>
        )}
      </div>
      <Field label="Address" value={f.address} onChange={set('address')} />
    </Modal>
  );
}

function Permissions() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [role, setRole] = useState('branch_manager');
  useEffect(() => { api('/admin/permissions').then(setD).catch(e => toast(e.message, 'red')); }, []);
  if (!d) return null;
  const perms = d.matrix[role] || [];
  const toggle = p => setD(x => ({
    ...x,
    matrix: { ...x.matrix, [role]: perms.includes(p) ? perms.filter(y => y !== p) : [...perms, p] },
  }));
  const save = async () => {
    try {
      await api(`/admin/permissions/${role}`, { method: 'PUT', body: { permissions: perms } });
      toast(`Permissions updated for ${role.replace(/_/g, ' ')}. Users get them on next request.`, 'green');
    } catch (e) { toast(e.message, 'red'); }
  };
  const groups = {};
  d.all_permissions.forEach(p => {
    const g = p.split('.')[0];
    (groups[g] = groups[g] || []).push(p);
  });
  return (
    <Card title="Role permission matrix">
      <div className="toolbar">
        <select value={role} onChange={e => setRole(e.target.value)}>
          {d.roles.filter(r => r !== 'super_admin').map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <div className="spacer" />
        <button className="btn green" onClick={save}>Save Permissions</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <h4 style={{ margin: '6px 0', textTransform: 'capitalize' }}>{g}</h4>
            {list.map(p => (
              <label key={p} className="checkbox-row">
                <input type="checkbox" checked={perms.includes(p)} onChange={() => toggle(p)} />
                {p.split('.')[1].replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="muted">Super admin always has every permission. Per-user overrides are available via the API (extra/denied permissions).</div>
    </Card>
  );
}

function Audit() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  useEffect(() => { api('/admin/audit-logs').then(d => setRows(d.logs)).catch(e => toast(e.message, 'red')); }, []);
  return (
    <Card title="Activity log — every important action is recorded"
      actions={<ExportBtn name="activity-log" rows={rows} columns={[
        { key: 'created_at', label: 'Time' }, { key: 'user_name', label: 'User' },
        { key: 'branch_name', label: 'Branch' }, { key: 'action', label: 'Action' },
        { key: 'entity', label: 'Entity' }, { key: 'details', label: 'Details' }, { key: 'ip', label: 'IP' },
      ]} />}>
      <Table columns={[
        { key: 'created_at', label: 'Time' },
        { key: 'user_name', label: 'User' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'action', label: 'Action', render: r => <Badge color="blue">{r.action}</Badge> },
        { key: 'entity', label: 'Entity', render: r => `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}` },
        { key: 'details', label: 'Details (old → new)', render: r => <AuditDetails text={r.details} /> },
        { key: 'ip', label: 'IP' },
      ]} rows={rows} keyFn={r => r.id} />
    </Card>
  );
}

function AuditDetails({ text }) {
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      return (
        <div>
          {Object.entries(obj).map(([field, v]) => (
            <div key={field} style={{ fontSize: '.8rem' }}>
              <b>{field}</b>: <span className="muted">{String(v.old ?? '')}</span> → {String(v.new ?? '')}
            </div>
          ))}
        </div>
      );
    }
  } catch { /* plain text */ }
  return <span>{text}</span>;
}
