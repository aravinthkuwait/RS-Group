import React, { useState } from 'react';
import { useConnectivity, humanDuration } from './useConnectivity.js';
import { Card } from './ui.jsx';

const fmtTime = ts => new Date(ts).toLocaleString('en-IN', { hour12: true });

// Homepage card: live online/offline status, how long it's lasted, and the log.
export function ConnectionStatus() {
  const { online, since, history } = useConnectivity();
  const [showLog, setShowLog] = useState(false);
  const up = online === true;
  const pending = online === null;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{
          width: 12, height: 12, borderRadius: '50%',
          background: pending ? '#c9a227' : up ? '#2e8b3d' : '#c0392b',
          boxShadow: `0 0 0 4px ${pending ? 'rgba(201,162,39,.18)' : up ? 'rgba(46,139,61,.18)' : 'rgba(192,57,43,.18)'}`,
        }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700 }}>
            {pending ? 'Checking connection…' : up ? '🟢 Online — connected to RS Group server' : '🔴 Offline — cannot reach server'}
          </div>
          <div className="muted" style={{ fontSize: '.85rem' }}>
            {!pending && <>{up ? 'Online' : 'Offline'} for <b>{humanDuration(Date.now() - since)}</b> · since {fmtTime(since)}</>}
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => setShowLog(s => !s)}>
          {showLog ? 'Hide history' : `Connection history (${history.length})`}
        </button>
      </div>

      {showLog && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th>Status</th><th>From</th><th>To</th><th className="num">Duration</th></tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan="4"><div className="empty">No status changes recorded yet — the log fills as the connection changes.</div></td></tr>}
              {history.map((h, i) => (
                <tr key={i}>
                  <td><span className={`badge ${h.status === 'online' ? 'green' : 'red'}`}>{h.status}</span></td>
                  <td className="muted">{fmtTime(h.start)}</td>
                  <td className="muted">{h.end ? fmtTime(h.end) : '—'}</td>
                  <td className="num">{humanDuration((h.end || Date.now()) - h.start)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Compact always-visible dot for the topbar
export function ConnectionDot() {
  const { online, since } = useConnectivity();
  const up = online === true;
  const pending = online === null;
  const title = pending ? 'Checking connection…'
    : `${up ? 'Online' : 'Offline'} for ${humanDuration(Date.now() - since)}`;
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.75rem', color: up ? '#2e8b3d' : pending ? '#c9a227' : '#c0392b', fontWeight: 700 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'currentColor' }} />
      {pending ? '…' : up ? 'Online' : 'Offline'}
    </span>
  );
}
