import React, { useEffect, useState } from 'react';
import { api, fmt, today } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Tabs, Modal, Field, Badge, useToast } from '../ui.jsx';

export default function Purchases() {
  const [tab, setTab] = useState('purchases');
  return (
    <div>
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'purchases', label: '📦 Purchase Invoices' },
        { key: 'suppliers', label: '🏭 Suppliers & Ledger' },
        { key: 'dues', label: '💸 Pending Dues' },
        { key: 'returns', label: '↩ Purchase Returns' },
      ]} />
      {tab === 'purchases' && <PurchaseList />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'dues' && <Dues />}
      {tab === 'returns' && <PReturns />}
    </div>
  );
}

function PurchaseList() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState(null);
  const [returning, setReturning] = useState(null);

  const load = () => api('/purchases', { params: { branch_id: branchId } })
    .then(d => setRows(d.purchases)).catch(e => toast(e.message, 'red'));
  useEffect(load, [branchId]);

  const open = id => api(`/purchases/${id}`).then(d => setView(d.purchase)).catch(e => toast(e.message, 'red'));

  return (
    <Card>
      <div className="toolbar">
        <div className="spacer" />
        {can(user, 'purchases.manage') && <button className="btn" onClick={() => setShowNew(true)}>+ New Purchase Entry</button>}
      </div>
      <Table
        columns={[
          { key: 'invoice_no', label: 'Invoice', render: r => <a href="#" onClick={e => { e.preventDefault(); open(r.id); }}>{r.invoice_no}</a> },
          { key: 'invoice_date', label: 'Date' },
          { key: 'supplier_name', label: 'Supplier' },
          { key: 'branch_name', label: 'Branch' },
          { key: 'total', label: 'Total', num: true, render: r => <b>{fmt(r.total)}</b> },
          { key: 'paid_amount', label: 'Paid', num: true, render: r => fmt(r.paid_amount) },
          { key: 'pending_amount', label: 'Pending', num: true, render: r => r.pending_amount > 0.01 ? <b style={{ color: 'var(--red)' }}>{fmt(r.pending_amount)}</b> : <Badge color="green">paid</Badge> },
          { key: 'status', label: 'Status', render: r => <Badge>{r.status}</Badge> },
        ]}
        rows={rows}
      />
      {showNew && <NewPurchase onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {view && (
        <Modal wide title={`Purchase ${view.invoice_no} — ${view.supplier_name}`} onClose={() => setView(null)} footer={
          <>
            {can(user, 'purchases.manage') && <button className="btn orange" onClick={() => { setReturning(view); setView(null); }}>↩ Return to supplier</button>}
            <button className="btn ghost" onClick={() => setView(null)}>Close</button>
          </>
        }>
          {view.invoice_file && <div style={{ marginBottom: 10 }}><a href={view.invoice_file} target="_blank" rel="noreferrer">📎 View uploaded supplier invoice</a></div>}
          <Table columns={[
            { key: 'medicine_name', label: 'Medicine' },
            { key: 'batch_no', label: 'Batch' },
            { key: 'expiry_date', label: 'Expiry' },
            { key: 'qty', label: 'Qty', num: true },
            { key: 'free_qty', label: 'Free', num: true, render: r => r.free_qty || '' },
            { key: 'purchase_price', label: 'Cost', num: true, render: r => fmt(r.purchase_price) },
            { key: 'mrp', label: 'MRP', num: true, render: r => fmt(r.mrp) },
            { key: 'amount', label: 'Amount', num: true, render: r => fmt(r.amount) },
          ]} rows={view.items} />
          <div className="right" style={{ marginTop: 10 }}>
            <div className="muted">GST: {fmt(view.gst_amount)}</div>
            <b style={{ fontSize: '1.1rem' }}>Total: {fmt(view.total)}</b>
          </div>
        </Modal>
      )}
      {returning && <PurchaseReturnModal purchase={returning} onClose={() => setReturning(null)} onDone={() => { setReturning(null); load(); }} />}
    </Card>
  );
}

function NewPurchase({ onClose, onSaved }) {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [meds, setMeds] = useState([]);
  const [f, setF] = useState({ supplier_id: '', invoice_no: '', invoice_date: today(), paid_amount: '', paid_method: 'bank' });
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [invoiceFile, setInvoiceFile] = useState(null);

  useEffect(() => { api('/purchases/suppliers').then(d => setSuppliers(d.suppliers)); }, []);
  useEffect(() => {
    if (q.length < 2) { setMeds([]); return; }
    const t = setTimeout(() => api('/inventory/medicines', { params: { q, limit: 10 } }).then(d => setMeds(d.medicines)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const addItem = m => {
    setItems(it => [...it, {
      medicine_id: m.id, name: m.name, batch_no: '', expiry_date: '', qty: '', free_qty: '',
      purchase_price: '', mrp: '', selling_price: '', gst_rate: m.gst_rate,
    }]);
    setQ(''); setMeds([]);
  };
  const setItem = (i, k) => e => setItems(items => items.map((it, ix) => ix === i ? { ...it, [k]: e.target.value } : it));
  const total = items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.purchase_price) || 0), 0);

  const onFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) return toast('File too large (max 1.4MB)', 'red');
    const r = new FileReader();
    r.onload = () => setInvoiceFile(r.result);
    r.readAsDataURL(file);
  };

  const save = async () => {
    try {
      await api('/purchases', {
        method: 'POST',
        body: {
          ...f, supplier_id: Number(f.supplier_id), paid_amount: Number(f.paid_amount) || 0,
          invoice_file: invoiceFile || undefined,
          items: items.map(it => ({
            medicine_id: it.medicine_id, batch_no: it.batch_no, expiry_date: it.expiry_date,
            qty: Number(it.qty), free_qty: Number(it.free_qty) || 0,
            purchase_price: Number(it.purchase_price), mrp: Number(it.mrp),
            selling_price: Number(it.selling_price) || Number(it.mrp),
          })),
        },
      });
      toast('Purchase recorded — stock updated batch-wise', 'green');
      onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };

  return (
    <Modal wide title="New purchase entry" onClose={onClose} footer={
      <>
        <div style={{ flex: 1, fontWeight: 700 }}>Total: {fmt(total)}</div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn green" onClick={save} disabled={!f.supplier_id || !f.invoice_no || !items.length}>Save Purchase</button>
      </>
    }>
      <div className="form-row">
        <Field label="Supplier *">
          <select value={f.supplier_id} onChange={e => setF(s => ({ ...s, supplier_id: e.target.value }))}>
            <option value="">— choose —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Supplier invoice no *" value={f.invoice_no} onChange={e => setF(s => ({ ...s, invoice_no: e.target.value }))} />
        <Field label="Invoice date" type="date" value={f.invoice_date} onChange={e => setF(s => ({ ...s, invoice_date: e.target.value }))} />
      </div>
      <div className="form-row">
        <Field label="Paid now (₹)" type="number" value={f.paid_amount} onChange={e => setF(s => ({ ...s, paid_amount: e.target.value }))} placeholder="0 = full credit" />
        <Field label="Payment method">
          <select value={f.paid_method} onChange={e => setF(s => ({ ...s, paid_method: e.target.value }))}>
            <option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
          </select>
        </Field>
        <Field label="Upload supplier invoice (image/PDF)"><input type="file" accept="image/*,.pdf" onChange={onFile} /></Field>
      </div>
      {invoiceFile && <div className="ok-msg">Invoice file attached ✓</div>}

      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input className="input" placeholder="🔍 Add medicine…" value={q} onChange={e => setQ(e.target.value)} />
        {meds.length > 0 && (
          <div className="pos-search-results">
            {meds.map(m => (
              <div key={m.id} className="item" onMouseDown={() => addItem(m)}>
                <div><b>{m.name}</b> <span className="muted">{m.brand}</span></div>
                <div className="muted">GST {m.gst_rate}%</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Medicine</th><th>Batch *</th><th>Expiry *</th><th className="num">Qty *</th><th className="num">Free</th><th className="num">Cost *</th><th className="num">MRP *</th><th className="num">Selling</th><th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan="9"><div className="empty">Search above to add purchase items</div></td></tr>}
            {items.map((it, i) => (
              <tr key={i}>
                <td><b>{it.name}</b></td>
                <td><input className="input" style={{ width: 90 }} value={it.batch_no} onChange={setItem(i, 'batch_no')} /></td>
                <td><input className="input" type="date" style={{ width: 140 }} value={it.expiry_date} onChange={setItem(i, 'expiry_date')} /></td>
                <td><input className="input" type="number" style={{ width: 66, textAlign: 'right' }} value={it.qty} onChange={setItem(i, 'qty')} /></td>
                <td><input className="input" type="number" style={{ width: 60, textAlign: 'right' }} value={it.free_qty} onChange={setItem(i, 'free_qty')} /></td>
                <td><input className="input" type="number" style={{ width: 80, textAlign: 'right' }} value={it.purchase_price} onChange={setItem(i, 'purchase_price')} /></td>
                <td><input className="input" type="number" style={{ width: 80, textAlign: 'right' }} value={it.mrp} onChange={setItem(i, 'mrp')} /></td>
                <td><input className="input" type="number" style={{ width: 80, textAlign: 'right' }} value={it.selling_price} onChange={setItem(i, 'selling_price')} placeholder="=MRP" /></td>
                <td><button className="x-btn" onClick={() => setItems(items => items.filter((_, ix) => ix !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function PurchaseReturnModal({ purchase, onClose, onDone }) {
  const toast = useToast();
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const refund = purchase.items.reduce((a, it) => a + (Number(qty[it.id]) || 0) * it.purchase_price, 0);
  const submit = async () => {
    const sel = purchase.items.filter(it => Number(qty[it.id]) > 0).map(it => ({ purchase_item_id: it.id, qty: Number(qty[it.id]) }));
    if (!sel.length) return toast('Enter quantities', 'red');
    try {
      const d = await api(`/purchases/${purchase.id}/returns`, { method: 'POST', body: { items: sel, reason } });
      toast(`Return recorded — ${fmt(d.amount)} adjusted against supplier`, 'green');
      onDone();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={`Return to ${purchase.supplier_name}`} onClose={onClose} footer={
      <>
        <div style={{ flex: 1, fontWeight: 700 }}>Return value: {fmt(refund)}</div>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn orange" onClick={submit}>Confirm Return</button>
      </>
    }>
      <Table columns={[
        { key: 'medicine_name', label: 'Medicine' },
        { key: 'batch_no', label: 'Batch' },
        { key: 'qty', label: 'Purchased', num: true },
        {
          label: 'Return qty', num: true, render: r => (
            <input type="number" min="0" className="input" style={{ width: 80, textAlign: 'right' }}
              value={qty[r.id] || ''} onChange={e => setQty(q => ({ ...q, [r.id]: e.target.value }))} />
          ),
        },
      ]} rows={purchase.items} />
      <Field label="Reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. damaged in transit, near expiry" />
    </Modal>
  );
}

function Suppliers() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [paying, setPaying] = useState(null);

  const load = () => api('/purchases/suppliers').then(d => setRows(d.suppliers)).catch(e => toast(e.message, 'red'));
  useEffect(load, []);

  const openLedger = s => api(`/purchases/suppliers/${s.id}/ledger`).then(setLedger).catch(e => toast(e.message, 'red'));

  return (
    <Card>
      <div className="toolbar">
        <div className="spacer" />
        {can(user, 'suppliers.manage') && <button className="btn" onClick={() => setEdit({})}>+ Add Supplier</button>}
      </div>
      <Table columns={[
        { key: 'name', label: 'Supplier', render: r => <a href="#" onClick={e => { e.preventDefault(); openLedger(r); }}><b>{r.name}</b></a> },
        { key: 'contact_person', label: 'Contact' },
        { key: 'phone', label: 'Phone' },
        { key: 'gstin', label: 'GSTIN' },
        { key: 'balance', label: 'Balance due', num: true, render: r => r.balance > 0 ? <b style={{ color: 'var(--red)' }}>{fmt(r.balance)}</b> : <Badge color="green">clear</Badge> },
        {
          label: '', render: r => (
            <div style={{ display: 'flex', gap: 6 }}>
              {can(user, 'accounts.manage', 'purchases.manage') && r.balance > 0 && <button className="btn green sm" onClick={() => setPaying(r)}>Pay</button>}
              {can(user, 'suppliers.manage') && <button className="btn ghost sm" onClick={() => setEdit(r)}>Edit</button>}
            </div>
          ),
        },
      ]} rows={rows} />
      {edit && <SupplierModal s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {paying && <PaySupplierModal s={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load(); }} />}
      {ledger && (
        <Modal wide title={`Ledger — ${ledger.supplier.name}`} onClose={() => setLedger(null)}>
          <div className="muted" style={{ marginBottom: 10 }}>Opening balance: {fmt(ledger.opening_balance)} · Current due: <b style={{ color: ledger.balance > 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(ledger.balance)}</b></div>
          <Table columns={[
            { key: 'date', label: 'Date' },
            { key: 'type', label: 'Entry' },
            { key: 'invoice_no', label: 'Ref' },
            { key: 'debit', label: 'Debit', num: true, render: r => r.debit ? fmt(r.debit) : '' },
            { key: 'credit', label: 'Credit', num: true, render: r => r.credit ? fmt(r.credit) : '' },
            { key: 'balance', label: 'Balance', num: true, render: r => fmt(r.balance) },
          ]} rows={ledger.ledger} keyFn={(r) => `${r.type}-${r.id}`} />
        </Modal>
      )}
    </Card>
  );
}

function SupplierModal({ s, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: s.name || '', contact_person: s.contact_person || '', phone: s.phone || '', email: s.email || '',
    address: s.address || '', gstin: s.gstin || '', drug_license: s.drug_license || '', opening_balance: s.opening_balance || 0,
  });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    try {
      if (s.id) await api(`/purchases/suppliers/${s.id}`, { method: 'PUT', body: { ...f, opening_balance: Number(f.opening_balance) } });
      else await api('/purchases/suppliers', { method: 'POST', body: { ...f, opening_balance: Number(f.opening_balance) } });
      toast('Supplier saved', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={s.id ? `Edit ${s.name}` : 'Add supplier'} onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save} disabled={!f.name}>Save</button></>
    }>
      <div className="form-row">
        <Field label="Name *" value={f.name} onChange={set('name')} />
        <Field label="Contact person" value={f.contact_person} onChange={set('contact_person')} />
      </div>
      <div className="form-row">
        <Field label="Phone" value={f.phone} onChange={set('phone')} />
        <Field label="Email" value={f.email} onChange={set('email')} />
      </div>
      <div className="form-row">
        <Field label="GSTIN" value={f.gstin} onChange={set('gstin')} />
        <Field label="Drug license" value={f.drug_license} onChange={set('drug_license')} />
        <Field label="Opening balance (₹)" type="number" value={f.opening_balance} onChange={set('opening_balance')} />
      </div>
      <Field label="Address" value={f.address} onChange={set('address')} />
    </Modal>
  );
}

function PaySupplierModal({ s, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(s.balance);
  const [method, setMethod] = useState('bank');
  const [refNo, setRefNo] = useState('');
  const save = async () => {
    try {
      await api(`/purchases/suppliers/${s.id}/payments`, { method: 'POST', body: { amount: Number(amount), method, ref_no: refNo } });
      toast('Payment recorded', 'green'); onDone();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={`Pay ${s.name}`} onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save}>Record Payment</button></>
    }>
      <div className="muted" style={{ marginBottom: 10 }}>Current due: <b>{fmt(s.balance)}</b></div>
      <div className="form-row">
        <Field label="Amount *" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
        <Field label="Method">
          <select value={method} onChange={e => setMethod(e.target.value)}>
            <option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option>
          </select>
        </Field>
        <Field label="Reference no" value={refNo} onChange={e => setRefNo(e.target.value)} />
      </div>
    </Modal>
  );
}

function Dues() {
  const toast = useToast();
  const [d, setD] = useState(null);
  useEffect(() => { api('/purchases/dues/summary').then(setD).catch(e => toast(e.message, 'red')); }, []);
  if (!d) return null;
  return (
    <Card title={`Pending supplier payments — total ${fmt(d.total)}`}>
      <Table columns={[
        { key: 'name', label: 'Supplier' },
        { key: 'phone', label: 'Phone' },
        { key: 'balance', label: 'Due', num: true, render: r => <b style={{ color: 'var(--red)' }}>{fmt(r.balance)}</b> },
      ]} rows={d.dues} empty="No pending dues 🎉" />
    </Card>
  );
}

function PReturns() {
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api('/purchases/returns/list', { params: { branch_id: branchId } })
      .then(d => setRows(d.returns)).catch(e => toast(e.message, 'red'));
  }, [branchId]);
  return (
    <Card title="Purchase returns to suppliers">
      <Table columns={[
        { key: 'created_at', label: 'Date' },
        { key: 'supplier_name', label: 'Supplier' },
        { key: 'invoice_no', label: 'Against invoice' },
        { key: 'branch_name', label: 'Branch' },
        { key: 'reason', label: 'Reason' },
        { key: 'amount', label: 'Amount', num: true, render: r => fmt(r.amount) },
      ]} rows={rows} />
    </Card>
  );
}
