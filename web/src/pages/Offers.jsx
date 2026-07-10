import React, { useEffect, useState } from 'react';
import { api, fmt, today } from '../api.js';
import { useBranch } from '../App.jsx';
import { Card, Field, Modal, Badge, useToast, ExportBtn } from '../ui.jsx';

const empty = {
  name: '', description: '', branch_id: '', discount_type: 'percent', discount_value: '',
  applies_to: 'all', category: '', medicine_id: '', min_bill_amount: '',
  from_date: today(), to_date: today(),
};

export default function Offers() {
  const { options: branches } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);
  const [categories, setCategories] = useState([]);
  const [medicines, setMedicines] = useState([]);

  const load = () => api('/promotions').then(d => setRows(d.promotions)).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api('/admin/settings').then(d => setCategories(d.settings.medicine_categories || [])).catch(() => {});
    api('/inventory/medicines', { params: { limit: 500 } }).then(d => setMedicines(d.medicines)).catch(() => {});
  }, []);

  const isLive = p => p.active && p.from_date <= today() && p.to_date >= today();

  const del = async (p) => {
    if (!confirm(`Delete offer "${p.name}"?`)) return;
    try {
      const d = await api(`/promotions/${p.id}`, { method: 'DELETE' });
      toast(d.message || 'Offer deleted', 'green');
      load();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Card title="Promotional discount schemes" actions={
        <>
          <ExportBtn name="discount-offers" columns={[
            { key: 'name', label: 'Offer' }, { key: 'branch', label: 'Branch' },
            { key: 'type', label: 'Type' }, { key: 'value', label: 'Value' },
            { key: 'applies', label: 'Applies To' }, { key: 'min_bill', label: 'Min Bill' },
            { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'status', label: 'Status' },
          ]} rows={rows.map(p => ({
            name: p.name, branch: p.branch_name || 'All branches', type: p.discount_type,
            value: p.discount_value,
            applies: p.applies_to === 'all' ? 'Whole bill' : p.applies_to === 'category' ? p.category : p.medicine_name,
            min_bill: p.min_bill_amount, from: p.from_date, to: p.to_date,
            status: isLive(p) ? 'live' : p.active ? 'scheduled/over' : 'inactive',
          }))} />
          <button className="btn green sm" onClick={() => setModal({ ...empty })}>＋ New Offer</button>
        </>
      }>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Offer</th><th>Branch</th><th>Discount</th><th>Applies To</th>
              <th>Min Bill</th><th>Valid</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="8"><div className="empty">No offers yet — create one to give promotional discounts at billing.</div></td></tr>}
              {rows.map(p => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="muted" style={{ fontSize: '.75rem' }}>{p.description}</div></td>
                  <td>{p.branch_name || <span className="muted">All branches</span>}</td>
                  <td>{p.discount_type === 'percent' ? `${p.discount_value}%` : fmt(p.discount_value)}</td>
                  <td>{p.applies_to === 'all' ? 'Whole bill' : p.applies_to === 'category' ? `Category: ${p.category}` : `Item: ${p.medicine_name || ''}`}</td>
                  <td className="num">{p.min_bill_amount > 0 ? fmt(p.min_bill_amount) : '—'}</td>
                  <td className="muted">{p.from_date} → {p.to_date}</td>
                  <td>{isLive(p) ? <Badge color="green">LIVE</Badge>
                    : p.active ? <Badge color="orange">{p.from_date > today() ? 'Scheduled' : 'Ended'}</Badge>
                    : <Badge color="red">Inactive</Badge>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => setModal({
                      ...p, branch_id: p.branch_id || '', medicine_id: p.medicine_id || '',
                      min_bill_amount: p.min_bill_amount || '',
                    })}>Edit</button>{' '}
                    <button className="btn ghost sm" onClick={() => del(p)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <OfferModal offer={modal} branches={branches} categories={categories} medicines={medicines}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
    </div>
  );
}

function OfferModal({ offer, branches, categories, medicines, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(offer);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        name: f.name, description: f.description, branch_id: f.branch_id || null,
        discount_type: f.discount_type, discount_value: Number(f.discount_value),
        applies_to: f.applies_to, category: f.category, medicine_id: f.medicine_id || null,
        min_bill_amount: Number(f.min_bill_amount) || 0,
        from_date: f.from_date, to_date: f.to_date,
        ...(f.id ? { active: f.active } : {}),
      };
      if (f.id) await api(`/promotions/${f.id}`, { method: 'PUT', body });
      else await api('/promotions', { method: 'POST', body });
      toast('Offer saved', 'green');
      onSaved();
    } catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  };

  return (
    <Modal title={f.id ? `Edit offer — ${offer.name}` : 'New promotional offer'} onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn green" disabled={busy || !f.name || !f.discount_value} onClick={save}>💾 Save Offer</button>
      </>
    }>
      <Field label="Offer name *" value={f.name} onChange={e => set('name', e.target.value)} />
      <Field label="Description" value={f.description} onChange={e => set('description', e.target.value)} />
      <div className="form-row">
        <Field label="Branch">
          <select className="input" value={f.branch_id} onChange={e => set('branch_id', e.target.value)}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Discount type">
          <select className="input" value={f.discount_type} onChange={e => set('discount_type', e.target.value)}>
            <option value="percent">Percentage (%)</option>
            <option value="amount">Fixed amount (₹)</option>
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field label={f.discount_type === 'percent' ? 'Discount % *' : 'Discount ₹ *'} type="number" min="0"
          value={f.discount_value} onChange={e => set('discount_value', e.target.value)} />
        <Field label="Minimum bill amount ₹" type="number" min="0"
          value={f.min_bill_amount} onChange={e => set('min_bill_amount', e.target.value)} />
      </div>
      <Field label="Applies to">
        <select className="input" value={f.applies_to} onChange={e => set('applies_to', e.target.value)}>
          <option value="all">Whole bill</option>
          <option value="category">A medicine category</option>
          <option value="medicine">A specific medicine</option>
        </select>
      </Field>
      {f.applies_to === 'category' && (
        <Field label="Category">
          <select className="input" value={f.category} onChange={e => set('category', e.target.value)}>
            <option value="">— choose —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      )}
      {f.applies_to === 'medicine' && (
        <Field label="Medicine">
          <select className="input" value={f.medicine_id} onChange={e => set('medicine_id', e.target.value)}>
            <option value="">— choose —</option>
            {medicines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      )}
      <div className="form-row">
        <Field label="Valid from *" type="date" value={f.from_date} onChange={e => set('from_date', e.target.value)} />
        <Field label="Valid to *" type="date" value={f.to_date} onChange={e => set('to_date', e.target.value)} />
      </div>
      {f.id != null && (
        <Field label="Status">
          <select className="input" value={f.active} onChange={e => set('active', Number(e.target.value))}>
            <option value={1}>Active</option>
            <option value={0}>Inactive</option>
          </select>
        </Field>
      )}
    </Modal>
  );
}
