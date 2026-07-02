import React, { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Tabs, Modal, Field, Badge, useToast } from '../ui.jsx';

export default function Inventory() {
  const [tab, setTab] = useState('medicines');
  return (
    <div>
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'medicines', label: '💊 Medicines' },
        { key: 'stock', label: '📦 Batch Stock' },
        { key: 'adjustments', label: '🛠 Adjustments & Damage' },
      ]} />
      {tab === 'medicines' && <Medicines />}
      {tab === 'stock' && <Stock />}
      {tab === 'adjustments' && <Adjustments />}
    </div>
  );
}

function Medicines() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [cats, setCats] = useState([]);
  const [edit, setEdit] = useState(null);
  const [page, setPage] = useState(1);

  const load = () => api('/inventory/medicines', { params: { q, category, branch_id: branchId, page, limit: 25 } })
    .then(d => { setRows(d.medicines); setTotal(d.total); }).catch(e => toast(e.message, 'red'));
  useEffect(load, [q, category, branchId, page]);
  useEffect(() => { api('/admin/settings').then(d => setCats(d.settings.medicine_categories || [])); }, []);

  return (
    <Card>
      <div className="toolbar">
        <input placeholder="Search name / generic / brand / barcode" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} style={{ width: 280 }} />
        <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="spacer" />
        <span className="muted">{total} medicines</span>
        {can(user, 'inventory.edit') && <button className="btn" onClick={() => setEdit({})}>+ Add Medicine</button>}
      </div>
      <Table
        columns={[
          { key: 'name', label: 'Name', render: r => <><b>{r.name}</b><div className="muted">{r.generic_name}</div></> },
          { key: 'category', label: 'Category' },
          { key: 'brand', label: 'Brand' },
          { key: 'gst_rate', label: 'GST%', num: true },
          { key: 'rack_location', label: 'Rack' },
          { key: 'min_stock', label: 'Min', num: true },
          {
            key: 'stock', label: 'Stock', num: true, render: r => (
              <Badge color={r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'orange' : 'green'}>{r.stock} {r.unit}</Badge>
            ),
          },
          { label: 'Rx', render: r => r.prescription_required ? <Badge color="orange">Rx</Badge> : '' },
          ...(can(user, 'inventory.edit') ? [{ label: '', render: r => <button className="btn ghost sm" onClick={() => setEdit(r)}>Edit</button> }] : []),
        ]}
        rows={rows}
      />
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
        <span className="muted">Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
        <button className="btn ghost sm" disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>
      {edit && <MedicineModal med={edit} cats={cats} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Card>
  );
}

function MedicineModal({ med, cats, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: med.name || '', generic_name: med.generic_name || '', category: med.category || 'Tablet',
    brand: med.brand || '', barcode: med.barcode || '', hsn: med.hsn || '3004', gst_rate: med.gst_rate ?? 12,
    unit: med.unit || 'Strip', rack_location: med.rack_location || '', min_stock: med.min_stock ?? 10,
    prescription_required: !!med.prescription_required,
  });
  const set = k => e => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    try {
      const body = { ...f, gst_rate: Number(f.gst_rate), min_stock: Number(f.min_stock), prescription_required: f.prescription_required ? 1 : 0 };
      if (med.id) await api(`/inventory/medicines/${med.id}`, { method: 'PUT', body });
      else await api('/inventory/medicines', { method: 'POST', body });
      toast('Medicine saved', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={med.id ? `Edit ${med.name}` : 'Add medicine'} onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save}>Save</button></>
    }>
      <div className="form-row">
        <Field label="Name *" value={f.name} onChange={set('name')} />
        <Field label="Generic name" value={f.generic_name} onChange={set('generic_name')} />
      </div>
      <div className="form-row">
        <Field label="Category"><select value={f.category} onChange={set('category')}>{cats.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Brand / company" value={f.brand} onChange={set('brand')} />
        <Field label="Barcode" value={f.barcode} onChange={set('barcode')} />
      </div>
      <div className="form-row">
        <Field label="HSN" value={f.hsn} onChange={set('hsn')} />
        <Field label="GST %" type="number" value={f.gst_rate} onChange={set('gst_rate')} />
        <Field label="Unit" value={f.unit} onChange={set('unit')} />
        <Field label="Rack location" value={f.rack_location} onChange={set('rack_location')} />
        <Field label="Min stock alert" type="number" value={f.min_stock} onChange={set('min_stock')} />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={f.prescription_required} onChange={set('prescription_required')} />
        Prescription required (Schedule H)
      </label>
    </Modal>
  );
}

function Stock() {
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const load = () => api('/inventory/stock', { params: { q, branch_id: branchId } })
    .then(d => setRows(d.stock)).catch(e => toast(e.message, 'red'));
  useEffect(load, [q, branchId]);
  const value = rows.reduce((a, r) => a + r.qty * r.purchase_price, 0);
  return (
    <Card>
      <div className="toolbar">
        <input placeholder="Search medicine or batch no" value={q} onChange={e => setQ(e.target.value)} style={{ width: 280 }} />
        <div className="spacer" />
        <span className="muted">{rows.length} batches · stock value {fmt(value)}</span>
      </div>
      <Table
        columns={[
          { key: 'medicine_name', label: 'Medicine' },
          { key: 'branch_code', label: 'Branch' },
          { key: 'batch_no', label: 'Batch' },
          {
            key: 'expiry_date', label: 'Expiry', render: r => (
              <span>
                {r.expiry_date}{' '}
                {r.days_to_expiry < 0 ? <Badge color="red">expired</Badge>
                  : r.days_to_expiry <= 90 ? <Badge color="orange">{r.days_to_expiry}d</Badge> : null}
              </span>
            ),
          },
          { key: 'rack_location', label: 'Rack' },
          { key: 'qty', label: 'Qty', num: true, render: r => <b>{r.qty}</b> },
          { key: 'damaged_qty', label: 'Damaged', num: true, render: r => r.damaged_qty || '' },
          { key: 'mrp', label: 'MRP', num: true, render: r => fmt(r.mrp) },
          { key: 'selling_price', label: 'Selling', num: true, render: r => fmt(r.selling_price) },
          { key: 'purchase_price', label: 'Cost', num: true, render: r => fmt(r.purchase_price) },
        ]}
        rows={rows}
        keyFn={r => r.id}
      />
    </Card>
  );
}

function Adjustments() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => api('/inventory/adjustments', { params: { branch_id: branchId } })
    .then(d => setRows(d.adjustments)).catch(e => toast(e.message, 'red'));
  useEffect(load, [branchId]);
  return (
    <Card>
      <div className="toolbar">
        <div className="spacer" />
        {can(user, 'inventory.adjust') && <button className="btn" onClick={() => setShow(true)}>+ New Adjustment</button>}
      </div>
      <Table
        columns={[
          { key: 'created_at', label: 'Date' },
          { key: 'medicine_name', label: 'Medicine' },
          { key: 'batch_no', label: 'Batch' },
          { key: 'branch_name', label: 'Branch' },
          { key: 'qty_change', label: 'Change', num: true, render: r => <b style={{ color: r.qty_change < 0 ? 'var(--red)' : 'var(--green)' }}>{r.qty_change > 0 ? '+' : ''}{r.qty_change}</b> },
          { key: 'type', label: 'Type', render: r => <Badge color={r.type === 'damage' ? 'red' : 'gray'}>{r.type}</Badge> },
          { key: 'reason', label: 'Reason' },
          { key: 'user_name', label: 'By' },
        ]}
        rows={rows}
      />
      {show && <AdjustModal onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />}
    </Card>
  );
}

function AdjustModal({ onClose, onSaved }) {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [change, setChange] = useState('');
  const [type, setType] = useState('adjustment');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (q.length < 2) return;
    const t = setTimeout(() => api('/inventory/stock', { params: { q, branch_id: branchId || user.branch_id } })
      .then(d => setBatches(d.stock)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const save = async () => {
    try {
      await api('/inventory/adjustments', {
        method: 'POST',
        body: { batch_id: Number(batchId), qty_change: type === 'adjustment' ? Number(change) : -Math.abs(Number(change)), type, reason },
      });
      toast('Stock adjusted', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <Modal title="Stock adjustment" onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save} disabled={!batchId || !change || !reason}>Save</button></>
    }>
      <Field label="Find batch (type medicine name)" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Dolo" />
      {batches.length > 0 && (
        <Field label="Batch">
          <select value={batchId} onChange={e => setBatchId(e.target.value)}>
            <option value="">— choose —</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.medicine_name} · {b.batch_no} · qty {b.qty} · exp {b.expiry_date}</option>)}
          </select>
        </Field>
      )}
      <div className="form-row">
        <Field label="Type">
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="adjustment">Correction (+/-)</option>
            <option value="damage">Damaged stock (-)</option>
            <option value="expiry_writeoff">Expiry write-off (-)</option>
          </select>
        </Field>
        <Field label={type === 'adjustment' ? 'Quantity change (e.g. -2 or 5)' : 'Quantity to remove'} type="number" value={change} onChange={e => setChange(e.target.value)} />
      </div>
      <Field label="Reason *" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. physical count mismatch, broken strip" />
    </Modal>
  );
}
