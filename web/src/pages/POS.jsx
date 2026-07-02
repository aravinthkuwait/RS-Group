import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fileUrl, fmt } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Field, Modal, useToast, Badge } from '../ui.jsx';

export default function POS() {
  const { user } = useAuth();
  const { branchId, branches, canSwitch } = useBranch();
  const toast = useToast();
  const activeBranch = canSwitch ? (branchId || branches[0]?.id) : user.branch_id;

  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [hl, setHl] = useState(0);
  const [cart, setCart] = useState([]); // {batch_id, name, batch_no, expiry, mrp, price, gst_rate, qty, stock}
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [doctor, setDoctor] = useState('');
  const [discount, setDiscount] = useState('');
  const [pay, setPay] = useState({ mode: 'cash', cash: '', upi: '', card: '', credit: '' });
  const [split, setSplit] = useState(false);
  const [rx, setRx] = useState(null); // prescription base64
  const [held, setHeld] = useState([]);
  const [resumeId, setResumeId] = useState(null);
  const [done, setDone] = useState(null); // completed sale
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(null);
  const debounce = useRef(null);

  const loadHeld = () => api('/sales/held', { params: { branch_id: activeBranch } })
    .then(d => setHeld(d.sales)).catch(() => {});
  useEffect(() => { if (activeBranch) loadHeld(); }, [activeBranch]);

  // Search with debounce; barcode scanners "type" fast then Enter, which selects the exact match
  useEffect(() => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); return; }
    debounce.current = setTimeout(() => {
      api('/inventory/medicines/pos-search', { params: { q: q.trim(), branch_id: activeBranch } })
        .then(d => { setResults(d.results); setHl(0); })
        .catch(() => {});
    }, 160);
  }, [q, activeBranch]);

  const addToCart = (r) => {
    setCart(c => {
      const existing = c.find(i => i.batch_id === r.batch_id);
      if (existing) {
        if (existing.qty + 1 > r.qty) { toast(`Only ${r.qty} in stock for ${r.name}`, 'red'); return c; }
        return c.map(i => i.batch_id === r.batch_id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...c, {
        batch_id: r.batch_id, medicine_id: r.id, name: r.name, batch_no: r.batch_no, expiry: r.expiry_date,
        mrp: r.mrp, price: r.selling_price, gst_rate: r.gst_rate, qty: 1, stock: r.qty,
        rack: r.rack_location, rx: r.prescription_required,
      }];
    });
    setQ(''); setResults([]);
    searchRef.current?.focus();
  };

  const setQty = (batchId, qty) => setCart(c => c.map(i => {
    if (i.batch_id !== batchId) return i;
    const n = Math.max(1, Math.min(Number(qty) || 1, i.stock));
    return { ...i, qty: n };
  }));

  const subtotal = useMemo(() => cart.reduce((a, i) => a + i.qty * i.price, 0), [cart]);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const gst = cart.reduce((a, i) => a + (i.qty * i.price * i.gst_rate) / (100 + i.gst_rate), 0);
  const total = Math.round(subtotal - disc);
  const roundOff = total - (subtotal - disc);

  useEffect(() => {
    // Keep single-mode payment synced to total
    if (!split) setPay(p => ({ ...p, cash: '', upi: '', card: '', credit: '', [p.mode]: total || '' }));
  }, [total, split]);

  const paySum = ['cash', 'upi', 'card', 'credit'].reduce((a, k) => a + (Number(pay[k]) || 0), 0);

  const submit = async (hold = false) => {
    if (!cart.length) return toast('Cart is empty', 'red');
    if (!hold && Math.abs(paySum - total) > 0.01) return toast(`Payment ₹${paySum} must equal total ₹${total}`, 'red');
    setBusy(true);
    try {
      const data = await api('/sales', {
        method: 'POST',
        body: {
          branch_id: activeBranch,
          items: cart.map(i => ({ batch_id: i.batch_id, qty: i.qty })),
          customer_phone: customerPhone || undefined,
          customer_name: customerName || undefined,
          discount: disc, doctor_name: doctor,
          payment: { cash: Number(pay.cash) || 0, upi: Number(pay.upi) || 0, card: Number(pay.card) || 0, credit: Number(pay.credit) || 0 },
          hold, prescription_file: rx || undefined,
          resume_sale_id: resumeId || undefined,
        },
      });
      if (hold) {
        toast(`Bill held (${data.invoice_no}). Resume it anytime.`, 'green');
      } else {
        setDone(data.sale);
        toast(`Bill ${data.invoice_no} saved — ${fmt(data.total)}`, 'green');
      }
      setCart([]); setCustomerPhone(''); setCustomerName(''); setDoctor(''); setDiscount(''); setRx(null); setResumeId(null);
      setPay({ mode: 'cash', cash: '', upi: '', card: '', credit: '' }); setSplit(false);
      loadHeld();
    } catch (e) {
      toast(e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  const resumeHeld = (s) => {
    setCart(s.items.map(i => ({
      batch_id: i.batch_id, medicine_id: i.medicine_id, name: i.medicine_name, batch_no: i.batch_no,
      expiry: '', mrp: i.mrp, price: i.price, gst_rate: i.gst_rate, qty: i.qty, stock: 9999,
    })));
    setCustomerPhone(s.customer_phone || ''); setDoctor(s.doctor_name || '');
    setDiscount(s.discount || ''); setResumeId(s.id);
    toast(`Resumed held bill ${s.invoice_no}`);
  };

  const onRx = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1_400_000) return toast('File too large (max 1.4MB)', 'red');
    const reader = new FileReader();
    reader.onload = () => setRx(reader.result);
    reader.readAsDataURL(f);
  };

  const keyNav = (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(h + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); addToCart(results[hl]); }
    if (e.key === 'Escape') setResults([]);
  };

  return (
    <div>
      <div className="pos-grid">
        <div className="grid" style={{ gap: 14 }}>
          <Card>
            <div style={{ position: 'relative' }}>
              <input ref={searchRef} className="input" autoFocus
                placeholder="🔍 Scan barcode or search medicine by name / generic / batch…  (↑↓ + Enter)"
                value={q} onChange={e => setQ(e.target.value)} onKeyDown={keyNav} />
              {results.length > 0 && (
                <div className="pos-search-results">
                  {results.map((r, i) => (
                    <div key={r.batch_id} className={`item ${i === hl ? 'hl' : ''}`} onMouseDown={() => addToCart(r)}>
                      <div>
                        <b>{r.name}</b> <span className="muted">{r.generic_name}</span>
                        {!!r.prescription_required && <span className="badge orange" style={{ marginLeft: 6 }}>Rx</span>}
                        <div className="muted">Batch {r.batch_no} · Exp {r.expiry_date} · Rack {r.rack_location}</div>
                      </div>
                      <div className="right">
                        <b>{fmt(r.selling_price)}</b>
                        <div className="muted">{r.qty} in stock</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table className="tbl">
                <thead>
                  <tr><th>Item</th><th>Batch</th><th className="num">MRP</th><th className="num">Price</th><th className="num" style={{ width: 90 }}>Qty</th><th className="num">Amount</th><th /></tr>
                </thead>
                <tbody>
                  {cart.length === 0 && <tr><td colSpan="7"><div className="empty">Cart is empty — scan or search to add medicines</div></td></tr>}
                  {cart.map(i => (
                    <tr key={i.batch_id}>
                      <td><b>{i.name}</b>{!!i.rx && <span className="badge orange" style={{ marginLeft: 6 }}>Rx</span>}</td>
                      <td className="muted">{i.batch_no}</td>
                      <td className="num muted">{fmt(i.mrp)}</td>
                      <td className="num">{fmt(i.price)}</td>
                      <td className="num">
                        <input type="number" min="1" className="input" style={{ width: 74, padding: '5px 8px', textAlign: 'right' }}
                          value={i.qty} onChange={e => setQty(i.batch_id, e.target.value)} />
                      </td>
                      <td className="num"><b>{fmt(i.qty * i.price)}</b></td>
                      <td><button className="x-btn" onClick={() => setCart(c => c.filter(x => x.batch_id !== i.batch_id))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {held.length > 0 && (
            <Card title={`Held bills (${held.length})`}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {held.map(s => (
                  <button key={s.id} className="btn ghost sm" onClick={() => resumeHeld(s)}>
                    ⏸ {s.invoice_no} · {fmt(s.total)} {s.customer_name ? `· ${s.customer_name}` : ''}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="grid" style={{ gap: 14 }}>
          <Card title="Customer & prescription">
            <div className="form-row">
              <Field label="Mobile number" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+91 …" />
              <Field label="Name (new customers)" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="optional" />
            </div>
            <div className="form-row">
              <Field label="Doctor name" value={doctor} onChange={e => setDoctor(e.target.value)} placeholder="optional" />
              <Field label="Prescription upload">
                <input type="file" accept="image/*,.pdf" onChange={onRx} />
              </Field>
            </div>
            {rx && <div className="ok-msg">Prescription attached ✓ <a href="#" onClick={e => { e.preventDefault(); setRx(null); }}>remove</a></div>}
          </Card>

          <div className="pos-total">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.9rem', opacity: .9 }}>
              <span>Subtotal</span><span className="mono">{fmt(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.9rem', opacity: .9, margin: '4px 0' }}>
              <span>GST (incl.)</span><span className="mono">{fmt(gst)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0' }}>
              <span>Discount {can(user, 'billing.discount') ? '' : '(not permitted)'}</span>
              <input type="number" min="0" className="input" style={{ width: 100, textAlign: 'right' }}
                disabled={!can(user, 'billing.discount')}
                value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', opacity: .8 }}>
              <span>Round off</span><span className="mono">{roundOff.toFixed(2)}</span>
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,.3)', margin: '10px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>TOTAL</span><span className="big">{fmt(total)}</span>
            </div>
          </div>

          <Card title="Payment">
            {!split ? (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['cash', 'upi', 'card', 'credit'].map(m => (
                    <button key={m} className={`btn ${pay.mode === m ? '' : 'ghost'} sm`}
                      onClick={() => setPay({ mode: m, cash: '', upi: '', card: '', credit: '', [m]: total || '' })}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
                {pay.mode === 'credit' && !customerPhone && (
                  <div className="err-msg" style={{ marginTop: 10 }}>Credit sale needs a customer mobile number</div>
                )}
                <div style={{ marginTop: 10 }}>
                  <a href="#" onClick={e => { e.preventDefault(); setSplit(true); }}>Split payment across methods →</a>
                </div>
              </>
            ) : (
              <>
                <div className="form-row">
                  {['cash', 'upi', 'card', 'credit'].map(m => (
                    <Field key={m} label={m.toUpperCase()} type="number" min="0"
                      value={pay[m]} onChange={e => setPay(p => ({ ...p, [m]: e.target.value }))} />
                  ))}
                </div>
                <div className={Math.abs(paySum - total) > 0.01 ? 'err-msg' : 'ok-msg'}>
                  Entered {fmt(paySum)} of {fmt(total)}
                </div>
                <a href="#" onClick={e => { e.preventDefault(); setSplit(false); }}>← Single payment method</a>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn green lg" style={{ flex: 1, justifyContent: 'center' }} disabled={busy || !cart.length} onClick={() => submit(false)}>
                💾 Save & Print Bill
              </button>
              <button className="btn orange" disabled={busy || !cart.length} onClick={() => submit(true)}>⏸ Hold</button>
            </div>
          </Card>
        </div>
      </div>

      {done && <BillDoneModal sale={done} onClose={() => setDone(null)} />}
    </div>
  );
}

export function BillDoneModal({ sale, onClose }) {
  const toast = useToast();
  const wa = async () => {
    try {
      const d = await api(`/sales/${sale.id}/whatsapp`);
      window.open(d.url, '_blank');
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title={`Bill saved — ${sale.invoice_no}`} onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>New Bill</button>
        <button className="btn orange" onClick={wa}>📱 WhatsApp</button>
        <a className="btn green" href={fileUrl(`/sales/${sale.id}/pdf`)} target="_blank" rel="noreferrer">⬇ PDF Bill</a>
        <button className="btn" onClick={() => window.open(fileUrl(`/sales/${sale.id}/pdf`), '_blank')?.print?.()}>🖨 Print</button>
      </>
    }>
      <div style={{ textAlign: 'center', padding: '6px 0 14px' }}>
        <div style={{ fontSize: '2.4rem' }}>✅</div>
        <h3 style={{ margin: '6px 0' }}>{fmt(sale.total)}</h3>
        <Badge>{sale.status}</Badge>
        <div className="muted" style={{ marginTop: 8 }}>
          {sale.customer_name ? `Customer: ${sale.customer_name} (${sale.customer_phone})` : 'Walk-in customer'}
        </div>
      </div>
      <table className="tbl">
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {sale.items.map(i => (
            <tr key={i.id}><td>{i.medicine_name}</td><td className="num">{i.qty}</td><td className="num">{fmt(i.total)}</td></tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
