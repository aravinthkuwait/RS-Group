import React, { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Modal, Field, Badge, Tabs, useToast, useDebounced, ExportBtn } from '../ui.jsx';
import { BarList } from '../charts.jsx';

export default function Customers() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [tab, setTab] = useState('all');
  const [rows, setRows] = useState([]);
  const [dues, setDues] = useState({ dues: [], total: 0 });
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [profile, setProfile] = useState(null);
  const [paying, setPaying] = useState(null);

  const dq = useDebounced(q, 300);
  const load = () => {
    api('/customers', { params: { q: dq, branch_id: branchId, limit: 100 } }).then(d => setRows(d.customers)).catch(e => toast(e.message, 'red'));
    api('/customers/dues/list', { params: { branch_id: branchId } }).then(setDues).catch(() => {});
  };
  useEffect(() => { load(); }, [dq, branchId]);

  const openProfile = c => api(`/customers/${c.id}`).then(setProfile).catch(e => toast(e.message, 'red'));

  const remind = async c => {
    try {
      const d = await api(`/customers/${c.id}/reminder`);
      window.open(d.whatsapp_url, '_blank');
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <div>
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'all', label: `👥 All Customers (${rows.length})` },
        { key: 'dues', label: `💳 Credit Dues (${dues.dues.length})` },
      ]} />
      {tab === 'all' && (
        <Card>
          <div className="toolbar">
            <input placeholder="Search name or mobile" value={q} onChange={e => setQ(e.target.value)} style={{ width: 260 }} />
            <div className="spacer" />
            <ExportBtn name="customers" rows={rows} columns={[
              { key: 'name', label: 'Name' }, { key: 'phone', label: 'Mobile' },
              { key: 'branch_name', label: 'Branch' }, { key: 'total_bills', label: 'Bills' },
              { key: 'total_spent', label: 'Total spent' }, { key: 'loyalty_points', label: 'Points' },
              { key: 'credit_balance', label: 'Credit due' }, { key: 'last_purchase', label: 'Last purchase' },
            ]} />
            {can(user, 'customers.manage') && <button className="btn" onClick={() => setEdit({})}>+ Add Customer</button>}
          </div>
          <Table columns={[
            { key: 'name', label: 'Name', render: r => <a href="#" onClick={e => { e.preventDefault(); openProfile(r); }}><b>{r.name}</b></a> },
            { key: 'phone', label: 'Mobile' },
            { key: 'branch_name', label: 'Branch' },
            { key: 'total_bills', label: 'Bills', num: true },
            { key: 'total_spent', label: 'Total spent', num: true, render: r => fmt(r.total_spent) },
            { key: 'loyalty_points', label: 'Points', num: true, render: r => <Badge color="blue">{Math.round(r.loyalty_points)} ⭐</Badge> },
            { key: 'credit_balance', label: 'Credit due', num: true, render: r => r.credit_balance > 0 ? <b style={{ color: 'var(--red)' }}>{fmt(r.credit_balance)}</b> : '—' },
            { key: 'last_purchase', label: 'Last purchase', render: r => r.last_purchase?.slice(0, 10) || '—' },
            ...(can(user, 'customers.manage') ? [{ label: '', render: r => <button className="btn ghost sm" onClick={() => setEdit(r)}>Edit</button> }] : []),
          ]} rows={rows} />
        </Card>
      )}
      {tab === 'dues' && (
        <Card title={`Outstanding customer credit — total ${fmt(dues.total)}`}
          actions={<ExportBtn name="customer-credit-dues" rows={dues.dues} columns={[
            { key: 'name', label: 'Customer' }, { key: 'phone', label: 'Mobile' },
            { key: 'credit_balance', label: 'Credit due' },
          ]} />}>
          <Table columns={[
            { key: 'name', label: 'Customer' },
            { key: 'phone', label: 'Mobile' },
            { key: 'credit_balance', label: 'Due', num: true, render: r => <b style={{ color: 'var(--red)' }}>{fmt(r.credit_balance)}</b> },
            {
              label: '', render: r => (
                <div style={{ display: 'flex', gap: 6 }}>
                  {can(user, 'billing.create', 'accounts.manage') && <button className="btn green sm" onClick={() => setPaying(r)}>Receive payment</button>}
                  <button className="btn orange sm" onClick={() => remind(r)}>📱 Remind</button>
                </div>
              ),
            },
          ]} rows={dues.dues} empty="No credit dues 🎉" />
        </Card>
      )}

      {edit && <CustomerModal c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {paying && <ReceivePaymentModal c={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load(); }} />}
      {profile && (
        <Modal wide title={`${profile.customer.name} — ${profile.customer.phone}`} onClose={() => setProfile(null)}>
          <div className="stats-row" style={{ marginBottom: 16 }}>
            <div className="stat accent-blue"><div className="label">Loyalty points</div><div className="value">{Math.round(profile.customer.loyalty_points)}</div></div>
            <div className="stat accent-red"><div className="label">Credit due</div><div className="value">{fmt(profile.customer.credit_balance)}</div></div>
            <div className="stat accent-green"><div className="label">Bills</div><div className="value">{profile.sales.length}</div></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 14 }}>
            <Card title="Frequently bought (repeat purchases)">
              <BarList data={profile.top_items.map(t => ({ label: t.name, value: t.qty, sub: `${t.times} bills` }))} money={false} color={1} />
            </Card>
            <Card title="Monthly purchases">
              <BarList data={profile.monthly.map(m => ({ label: m.month, value: m.amount, sub: `${m.bills} bills` }))} />
            </Card>
          </div>
          <h4 style={{ margin: '8px 0' }}>Purchase history</h4>
          <Table columns={[
            { key: 'invoice_no', label: 'Invoice' },
            { key: 'created_at', label: 'Date' },
            { key: 'branch_name', label: 'Branch' },
            { key: 'total', label: 'Total', num: true, render: r => fmt(r.total) },
            { key: 'credit_amount', label: 'On credit', num: true, render: r => r.credit_amount ? fmt(r.credit_amount) : '' },
            { key: 'status', label: 'Status', render: r => <Badge>{r.status}</Badge> },
          ]} rows={profile.sales} />
        </Modal>
      )}
    </div>
  );
}

function CustomerModal({ c, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '',
    dob: c.dob || '', credit_limit: c.credit_limit || 0, notes: c.notes || '',
  });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    try {
      if (c.id) await api(`/customers/${c.id}`, { method: 'PUT', body: { ...f, credit_limit: Number(f.credit_limit) } });
      else await api('/customers', { method: 'POST', body: { ...f, credit_limit: Number(f.credit_limit) } });
      toast('Customer saved', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={c.id ? `Edit ${c.name}` : 'Add customer'} onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save} disabled={!f.name || !f.phone}>Save</button></>
    }>
      <div className="form-row">
        <Field label="Name *" value={f.name} onChange={set('name')} />
        <Field label="Mobile *" value={f.phone} onChange={set('phone')} />
      </div>
      <div className="form-row">
        <Field label="Email" value={f.email} onChange={set('email')} />
        <Field label="Date of birth" type="date" value={f.dob || ''} onChange={set('dob')} />
        <Field label="Credit limit (₹)" type="number" value={f.credit_limit} onChange={set('credit_limit')} />
      </div>
      <Field label="Address" value={f.address} onChange={set('address')} />
      <Field label="Notes" value={f.notes} onChange={set('notes')} />
    </Modal>
  );
}

function ReceivePaymentModal({ c, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(c.credit_balance);
  const [method, setMethod] = useState('cash');
  const save = async () => {
    try {
      const d = await api(`/customers/${c.id}/payments`, { method: 'POST', body: { amount: Number(amount), method } });
      toast(`Payment received. Remaining due: ${fmt(d.credit_balance)}`, 'green'); onDone();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={`Receive payment — ${c.name}`} onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save}>Save</button></>
    }>
      <div className="muted" style={{ marginBottom: 10 }}>Credit due: <b>{fmt(c.credit_balance)}</b></div>
      <div className="form-row">
        <Field label="Amount *" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
        <Field label="Method">
          <select value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
