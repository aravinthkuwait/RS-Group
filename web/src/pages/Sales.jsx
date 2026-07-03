import React, { useEffect, useState } from 'react';
import { api, fileUrl, fmt, monthStart, today } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Badge, Modal, Field, useToast } from '../ui.jsx';

export default function Sales() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ from: monthStart(), to: today(), status: '', payment: '', q: '' });
  const [view, setView] = useState(null);
  const [returning, setReturning] = useState(null);

  const load = () => api('/sales', { params: { ...filters, branch_id: branchId, limit: 100 } })
    .then(d => { setRows(d.sales); setTotal(d.total); }).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, [branchId, filters.from, filters.to, filters.status, filters.payment]);

  const openBill = id => api(`/sales/${id}`).then(d => setView(d.sale)).catch(e => toast(e.message, 'red'));

  const cancel = async (s) => {
    if (!confirm(`Cancel bill ${s.invoice_no}? Stock will be restored.`)) return;
    try {
      await api(`/sales/${s.id}/cancel`, { method: 'POST', body: {} });
      toast('Bill cancelled and stock restored', 'green'); setView(null); load();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card>
        <div className="toolbar">
          <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            {['completed', 'cancelled', 'returned', 'partial_return', 'held'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={filters.payment} onChange={e => setFilters(f => ({ ...f, payment: e.target.value }))}>
            <option value="">All payments</option>
            {['cash', 'upi', 'card', 'credit'].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
          <input placeholder="Invoice / customer / phone" value={filters.q}
            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && load()} />
          <button className="btn sm" onClick={load}>Search</button>
          <div className="spacer" />
          <span className="muted">{total} bills · {fmt(rows.reduce((a, r) => a + r.total, 0))} shown</span>
        </div>
        <Table
          columns={[
            { key: 'invoice_no', label: 'Invoice', render: r => <a href="#" onClick={e => { e.preventDefault(); openBill(r.id); }}>{r.invoice_no}</a> },
            { key: 'created_at', label: 'Date' },
            { key: 'branch_name', label: 'Branch' },
            { key: 'customer_name', label: 'Customer', render: r => r.customer_name || <span className="muted">Walk-in</span> },
            { key: 'staff_name', label: 'Staff' },
            { key: 'total', label: 'Total', num: true, render: r => <b>{fmt(r.total)}</b> },
            { label: 'Paid via', render: r => [r.paid_cash > 0 && 'Cash', r.paid_upi > 0 && 'UPI', r.paid_card > 0 && 'Card', r.credit_amount > 0 && 'Credit'].filter(Boolean).join(' + ') || '—' },
            { label: 'Status', render: r => <Badge>{r.status}</Badge> },
          ]}
          rows={rows}
        />
      </Card>

      {view && (
        <Modal wide title={`Bill ${view.invoice_no}`} onClose={() => setView(null)} footer={
          <>
            {can(user, 'billing.return') && ['completed', 'partial_return'].includes(view.status) && (
              <button className="btn orange" onClick={() => { setReturning(view); setView(null); }}>↩ Return items</button>
            )}
            {can(user, 'billing.cancel') && ['completed', 'held'].includes(view.status) && (
              <button className="btn red" onClick={() => cancel(view)}>Cancel bill</button>
            )}
            <a className="btn green" href={fileUrl(`/sales/${view.id}/pdf`)} target="_blank" rel="noreferrer">⬇ PDF</a>
          </>
        }>
          <div className="form-row" style={{ marginBottom: 10 }}>
            <div><span className="muted">Branch</span><div><b>{view.branch_name}</b></div></div>
            <div><span className="muted">Customer</span><div><b>{view.customer_name || 'Walk-in'}</b> {view.customer_phone}</div></div>
            <div><span className="muted">Staff</span><div>{view.staff_name}</div></div>
            <div><span className="muted">Status</span><div><Badge>{view.status}</Badge></div></div>
          </div>
          {view.doctor_name && <div className="muted" style={{ marginBottom: 8 }}>Doctor: {view.doctor_name}</div>}
          {view.prescription_file && (
            <div style={{ marginBottom: 10 }}>
              <a href={view.prescription_file} target="_blank" rel="noreferrer">📎 View uploaded prescription</a>
            </div>
          )}
          <Table
            columns={[
              { key: 'medicine_name', label: 'Item' },
              { key: 'batch_no', label: 'Batch' },
              { key: 'qty', label: 'Qty', num: true },
              { key: 'returned_qty', label: 'Returned', num: true, render: r => r.returned_qty || '' },
              { key: 'price', label: 'Price', num: true, render: r => fmt(r.price) },
              { key: 'gst_rate', label: 'GST%', num: true },
              { key: 'total', label: 'Amount', num: true, render: r => fmt(r.total) },
            ]}
            rows={view.items}
          />
          <div className="right" style={{ marginTop: 12, lineHeight: 1.8 }}>
            <div className="muted">Subtotal: {fmt(view.subtotal)} · Discount: {fmt(view.discount)} · GST incl.: {fmt(view.gst_amount)}</div>
            <div style={{ fontSize: '1.2rem' }}><b>Total: {fmt(view.total)}</b></div>
            <div className="muted">
              {[view.paid_cash > 0 && `Cash ${fmt(view.paid_cash)}`, view.paid_upi > 0 && `UPI ${fmt(view.paid_upi)}`,
                view.paid_card > 0 && `Card ${fmt(view.paid_card)}`, view.credit_amount > 0 && `Credit ${fmt(view.credit_amount)}`]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
        </Modal>
      )}

      {returning && <ReturnModal sale={returning} onClose={() => setReturning(null)} onDone={() => { setReturning(null); load(); }} />}
    </div>
  );
}

function ReturnModal({ sale, onClose, onDone }) {
  const toast = useToast();
  const [qty, setQtys] = useState({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const items = sale.items.filter(i => i.qty - i.returned_qty > 0);
  const refund = items.reduce((a, i) => a + (Number(qty[i.id]) || 0) * i.price, 0);

  const submit = async () => {
    const sel = items.filter(i => Number(qty[i.id]) > 0).map(i => ({ sale_item_id: i.id, qty: Number(qty[i.id]) }));
    if (!sel.length) return toast('Enter quantities to return', 'red');
    try {
      const d = await api(`/sales/${sale.id}/returns`, { method: 'POST', body: { items: sel, reason, refund_method: method } });
      toast(`Return saved — refund ${fmt(d.refund_amount)}`, 'green');
      onDone();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <Modal title={`Return items — ${sale.invoice_no}`} onClose={onClose} footer={
      <>
        <div style={{ flex: 1, fontWeight: 700 }}>Refund: {fmt(refund)}</div>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn orange" onClick={submit}>Confirm Return</button>
      </>
    }>
      <Table
        columns={[
          { key: 'medicine_name', label: 'Item' },
          { label: 'Sold', num: true, render: r => r.qty },
          { label: 'Already returned', num: true, render: r => r.returned_qty || 0 },
          {
            label: 'Return qty', num: true, render: r => (
              <input type="number" min="0" max={r.qty - r.returned_qty} className="input" style={{ width: 80, textAlign: 'right' }}
                value={qty[r.id] || ''} onChange={e => setQtys(q => ({ ...q, [r.id]: e.target.value }))} />
            ),
          },
          { label: 'Price', num: true, render: r => fmt(r.price) },
        ]}
        rows={items}
      />
      <div className="form-row" style={{ marginTop: 12 }}>
        <Field label="Reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. wrong medicine, adverse reaction" />
        <Field label="Refund method">
          <select value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash refund</option>
            <option value="upi">UPI refund</option>
            <option value="credit_note">Credit note (adjust customer credit)</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
