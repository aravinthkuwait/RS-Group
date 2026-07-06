import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Modal, Field, Badge, useToast, ExportBtn } from '../ui.jsx';

export default function Transfers() {
  const { user } = useAuth();
  const { branchId, branches } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [showNew, setShowNew] = useState(false);

  const load = () => api('/inventory/transfers', { params: { branch_id: branchId } })
    .then(d => setRows(d.transfers)).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, [branchId]);

  const receive = async t => {
    try {
      await api(`/inventory/transfers/${t.id}/receive`, { method: 'POST', body: {} });
      toast(`Transfer #${t.id} received into ${t.to_branch}`, 'green'); load();
    } catch (e) { toast(e.message, 'red'); }
  };
  const cancel = async t => {
    if (!confirm('Cancel this transfer and restore stock to the source branch?')) return;
    try {
      await api(`/inventory/transfers/${t.id}/cancel`, { method: 'POST', body: {} });
      toast('Transfer cancelled', 'green'); load();
    } catch (e) { toast(e.message, 'red'); }
  };

  const canReceive = t => t.status === 'pending' && (user.role === 'super_admin' || user.branch_id === t.to_branch_id);
  const canCancel = t => t.status === 'pending' && (user.role === 'super_admin' || user.branch_id === t.from_branch_id);

  return (
    <Card>
      <div className="toolbar">
        <div className="spacer" />
        <ExportBtn name="stock-transfers" rows={rows} columns={[
          { key: 'id', label: '#' }, { key: 'created_at', label: 'Date' },
          { key: 'from_branch', label: 'From' }, { key: 'to_branch', label: 'To' },
          { key: 'notes', label: 'Notes' }, { key: 'status', label: 'Status' },
        ]} />
        {can(user, 'inventory.transfer') && <button className="btn" onClick={() => setShowNew(true)}>+ New Transfer</button>}
      </div>
      <Table columns={[
        { key: 'id', label: '#' },
        { key: 'created_at', label: 'Date' },
        { key: 'from_branch', label: 'From' },
        { key: 'to_branch', label: 'To' },
        {
          label: 'Items', render: t => (
            <div>{t.items.map(i => <div key={i.id} className="muted">{i.medicine_name} · {i.batch_no} × <b>{i.qty}</b></div>)}</div>
          ),
        },
        { key: 'notes', label: 'Notes' },
        { key: 'status', label: 'Status', render: t => <Badge>{t.status}</Badge> },
        {
          label: '', render: t => (
            <div style={{ display: 'flex', gap: 6 }}>
              {canReceive(t) && <button className="btn green sm" onClick={() => receive(t)}>Receive</button>}
              {canCancel(t) && <button className="btn red sm" onClick={() => cancel(t)}>Cancel</button>}
            </div>
          ),
        },
      ]} rows={rows} />
      {showNew && <NewTransfer branches={branches} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </Card>
  );
}

function NewTransfer({ branches, onClose, onSaved }) {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [fromBranch, setFromBranch] = useState(user.role === 'super_admin' ? (branchId || branches[0]?.id) : user.branch_id);
  const [toBranch, setToBranch] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (q.length < 2) { setFound([]); return; }
    const t = setTimeout(() => api('/inventory/stock', { params: { q, branch_id: fromBranch } }).then(d => setFound(d.stock)), 200);
    return () => clearTimeout(t);
  }, [q, fromBranch]);

  const save = async () => {
    try {
      await api('/inventory/transfers', {
        method: 'POST',
        body: {
          from_branch_id: Number(fromBranch), to_branch_id: Number(toBranch), notes,
          items: items.map(i => ({ batch_id: i.batch_id, qty: Number(i.qty) })),
        },
      });
      toast('Transfer created — destination branch can now receive it', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <Modal wide title="New stock transfer" onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn green" onClick={save} disabled={!toBranch || !items.length || items.some(i => !i.qty)}>Create Transfer</button></>
    }>
      <div className="form-row">
        <Field label="From branch">
          <select value={fromBranch} disabled={user.role !== 'super_admin'}
            onChange={e => { setFromBranch(Number(e.target.value)); setItems([]); setFound([]); setQ(''); }}>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="To branch *">
          <select value={toBranch} onChange={e => setToBranch(e.target.value)}>
            <option value="">— choose —</option>
            {branches.filter(b => b.id !== Number(fromBranch)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input className="input" placeholder="🔍 Find batch in source branch…" value={q} onChange={e => setQ(e.target.value)} />
        {found.length > 0 && (
          <div className="pos-search-results">
            {found.map(b => (
              <div key={b.id} className="item" onMouseDown={() => {
                if (!items.some(i => i.batch_id === b.id)) setItems(it => [...it, { batch_id: b.id, name: b.medicine_name, batch_no: b.batch_no, max: b.qty, qty: '' }]);
                setQ(''); setFound([]);
              }}>
                <div><b>{b.medicine_name}</b> · {b.batch_no}</div>
                <div className="muted">{b.qty} available</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Table columns={[
        { key: 'name', label: 'Medicine' },
        { key: 'batch_no', label: 'Batch' },
        { key: 'max', label: 'Available', num: true },
        {
          label: 'Transfer qty', num: true, render: (r) => (
            <input type="number" min="1" max={r.max} className="input" style={{ width: 80, textAlign: 'right' }}
              value={r.qty} onChange={e => setItems(items => items.map(i => i.batch_id === r.batch_id ? { ...i, qty: e.target.value === '' ? '' : Math.max(1, Math.min(Number(e.target.value), r.max)) } : i))} />
          ),
        },
        { label: '', render: r => <button className="x-btn" onClick={() => setItems(items => items.filter(i => i.batch_id !== r.batch_id))}>✕</button> },
      ]} rows={items} keyFn={r => r.batch_id} empty="Search above to add batches" />
      <Field label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
    </Modal>
  );
}
