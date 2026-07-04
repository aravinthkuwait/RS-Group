import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Stat, useToast } from '../ui.jsx';

const mb = b => Number(b || 0) / 1048576;
const fmtSize = b => {
  const n = Number(b || 0);
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
};
const levelColor = { high: 'red', med: 'orange', low: 'blue', ok: 'green' };

// Owner "Usage & Cost" monitor — shows what drives Supabase/Railway cost and lets it be cleaned up.
export default function Usage() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => api('/admin/usage').then(setD).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, []);

  const cleanup = async (target, label) => {
    if (!confirm(`Clean up ${label}? This permanently deletes those rows to free space.`)) return;
    setBusy(target);
    try {
      const r = await api('/admin/usage/cleanup', { method: 'POST', body: { target } });
      toast(r.message, 'green');
      load();
    } catch (e) { toast(e.message, 'red'); }
    setBusy('');
  };

  if (!d) return <div className="empty">Loading usage…</div>;
  const blobBytes = d.blobs.prescriptions.bytes + d.blobs.invoices.bytes;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="stats-row">
        <Stat accent="blue" label="Database size" value={fmtSize(d.db_bytes)} sub="total on Supabase" />
        <Stat accent={mb(blobBytes) > 20 ? 'red' : 'orange'} label="File blobs in DB" value={fmtSize(blobBytes)}
          sub={`${d.blobs.prescriptions.count} Rx + ${d.blobs.invoices.count} invoices`} />
        <Stat accent="green" label="Bills (30 days)" value={d.activity.bills_30d} sub={`${d.activity.active_sessions} active sessions`} />
        <Stat accent="orange" label="Audit log rows" value={d.growth.audit_logs.rows} sub={`since ${d.growth.audit_logs.oldest || '—'}`} />
      </div>

      <Card title="What to resolve">
        {d.recommendations.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0' }}>
            <span className={`badge ${levelColor[r.level] || 'gray'}`}>{r.level === 'ok' ? '✓' : r.level.toUpperCase()}</span>
            <span>{r.text}</span>
          </div>
        ))}
      </Card>

      <Card title="Storage by table (biggest cost first)">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Table</th><th className="num">Rows (approx)</th><th className="num">Size</th><th style={{ width: '32%' }}>Share of DB</th></tr></thead>
            <tbody>
              {d.tables.slice(0, 14).map(t => (
                <tr key={t.name}>
                  <td><b>{t.name}</b></td>
                  <td className="num">{Number(t.est_rows).toLocaleString('en-IN')}</td>
                  <td className="num">{fmtSize(t.bytes)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, t.pct)}%`, height: '100%', background: t.pct > 30 ? 'var(--red)' : t.pct > 12 ? 'var(--orange)' : 'var(--brand, #1e4d8c)' }} />
                      </div>
                      <span className="muted" style={{ fontSize: '.78rem', width: 42, textAlign: 'right' }}>{t.pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Reclaim space (safe cleanup)">
        <div className="muted" style={{ marginBottom: 12 }}>
          These free storage &amp; shrink backups without touching business data. Deleting old logs and inlined files is the fastest way to cut Supabase cost.
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Item</th><th className="num">Reclaimable</th><th /></tr></thead>
            <tbody>
              <CleanRow label="Stale / revoked sessions" count={d.growth.sessions.stale} target="sessions" busy={busy} onRun={cleanup} />
              <CleanRow label="Login history &gt; 90 days" count={d.growth.login_history.old} target="login_history" busy={busy} onRun={cleanup} />
              <CleanRow label="Read notifications &gt; 30 days" count={d.growth.notifications.read} target="notifications" busy={busy} onRun={cleanup} />
              <CleanRow label="Audit entries &gt; 1 year" count={d.growth.audit_logs.rows > 50000 ? d.growth.audit_logs.rows : 0} target="audit_logs" busy={busy} onRun={cleanup} note="only when very large" />
              <CleanRow label="Prescription files &gt; 6 months" count={d.blobs.prescriptions.count} sub={fmtSize(d.blobs.prescriptions.bytes)} target="prescriptions" busy={busy} onRun={cleanup} />
              <CleanRow label="Supplier invoice files &gt; 6 months" count={d.blobs.invoices.count} sub={fmtSize(d.blobs.invoices.bytes)} target="invoice_files" busy={busy} onRun={cleanup} />
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Provider billing dashboards">
        <div className="muted" style={{ marginBottom: 10 }}>
          The actual ₹ amounts live with each provider. This page shows the in-database drivers you control; open these for exact invoices:
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {d.providers.map(p => (
            <a key={p.name} className="btn ghost sm" href={p.url} target="_blank" rel="noreferrer">
              {p.name} — {p.drivers} ↗
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}

function CleanRow({ label, count, sub, target, busy, onRun, note }) {
  const has = Number(count) > 0;
  return (
    <tr style={has ? {} : { opacity: 0.55 }}>
      <td dangerouslySetInnerHTML={{ __html: label }} />
      <td className="num">{has ? Number(count).toLocaleString('en-IN') : '0'}{sub && has ? <span className="muted"> · {sub}</span> : ''}{note && <div className="muted" style={{ fontSize: '.7rem' }}>{note}</div>}</td>
      <td style={{ textAlign: 'right' }}>
        <button className="btn ghost sm" disabled={!has || busy === target} onClick={() => onRun(target, label.replace(/&gt;/g, '>'))}>
          {busy === target ? 'Cleaning…' : 'Clean up'}
        </button>
      </td>
    </tr>
  );
}
