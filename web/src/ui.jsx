import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ---------- Debounced value (live search boxes) ----------
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ---------- CSV download (opens in Excel) ----------
export function exportCSV(filename, columns, rows) {
  const cols = columns.filter(c => c.key);
  const esc = x => {
    const s = x === null || x === undefined ? '' : String(x);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const lines = [cols.map(c => esc(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map(c => esc(r[c.key])).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// fetchRows: optional async () => rows — fetches the FULL dataset on click
// (pages shown on screen are often truncated); falls back to the given rows.
export function ExportBtn({ name, columns, rows, fetchRows }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    if (!fetchRows) return exportCSV(name, columns, rows);
    setBusy(true);
    try { exportCSV(name, columns, await fetchRows()); } finally { setBusy(false); }
  };
  return (
    <button className="btn ghost sm" disabled={busy || (!fetchRows && !rows?.length)} title="Download as Excel/CSV"
      onClick={click}>
      {busy ? '⏳ Preparing…' : '⬇ Download'}
    </button>
  );
}

// ---------- Toasts ----------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Form field ----------
export function Field({ label, children, ...rest }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children || <input {...rest} />}
    </div>
  );
}

// ---------- Stat card ----------
export function Stat({ label, value, sub, accent = 'blue' }) {
  return (
    <div className={`stat accent-${accent}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---------- Table ----------
export function Table({ columns, rows, empty = 'No records found', keyFn }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>{columns.map(c => <th key={c.key || c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length}><div className="empty">{empty}</div></td></tr>}
          {rows.map((r, i) => (
            <tr key={keyFn ? keyFn(r) : r.id ?? i}>
              {columns.map(c => (
                <td key={c.key || c.label} className={c.num ? 'num' : ''}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Badge ----------
const badgeColor = {
  completed: 'green', received: 'green', done: 'green', delivered: 'green', active: 'green',
  pending: 'orange', held: 'orange', in_progress: 'orange', out_for_delivery: 'orange', partial_return: 'orange',
  cancelled: 'red', returned: 'red', failed: 'red', expired: 'red', inactive: 'red',
};
export function Badge({ children, color }) {
  return <span className={`badge ${color || badgeColor[children] || 'gray'}`}>{String(children).replace(/_/g, ' ')}</span>;
}

// ---------- Tabs ----------
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button key={t.key} className={active === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Card ----------
export function Card({ title, actions, children, style }) {
  return (
    <div className="card" style={style}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{title}</h3>
          <div style={{ display: 'flex', gap: 8 }}>{actions}</div>
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}
