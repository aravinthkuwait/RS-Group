import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useBranch } from '../App.jsx';
import { Card, Badge, useToast, ExportBtn } from '../ui.jsx';

// History page for "new stock" popup notifications
export default function StockUpdates() {
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = () => api('/staff/stock-notifications', { params: { page, limit: 50, branch_id: branchId } })
    .then(d => { setRows(d.notifications); setTotal(d.total); })
    .catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, [page, branchId]);

  const parse = n => { try { return JSON.parse(n.data || '{}'); } catch { return {}; } };

  const markRead = async (ids) => {
    if (!ids.length) return;
    await api('/staff/notifications/read', { method: 'POST', body: { ids } }).catch(() => {});
    load();
  };

  const flat = rows.flatMap(n => {
    const d = parse(n);
    return (d.items || []).map(it => ({
      date: n.created_at, branch: d.branch_name, item: it.name, batch: it.batch_no,
      qty_added: it.qty_added, new_qty: it.new_qty, updated_by: d.updated_by,
      status: n.read ? 'Read' : 'Unread',
    }));
  });

  return (
    <Card title={`Stock update notifications (${total})`} actions={
      <>
        <ExportBtn name="stock-updates" columns={[
          { key: 'date', label: 'Date' }, { key: 'branch', label: 'Branch' }, { key: 'item', label: 'Item' },
          { key: 'batch', label: 'Batch' }, { key: 'qty_added', label: 'Qty Added' },
          { key: 'new_qty', label: 'Updated Stock' }, { key: 'updated_by', label: 'Updated By' },
          { key: 'status', label: 'Status' },
        ]} rows={flat} />
        <button className="btn ghost sm" disabled={!rows.some(n => !n.read)}
          onClick={() => markRead(rows.filter(n => !n.read).map(n => n.id))}>✓ Mark all read</button>
      </>
    }>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>
            <th>Date</th><th>Branch</th><th>Update</th><th>Items</th><th>Updated By</th><th>Status</th><th />
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7"><div className="empty">No stock updates yet. They appear here whenever stock is added by purchase, transfer or adjustment.</div></td></tr>}
            {rows.map(n => {
              const d = parse(n);
              return (
                <tr key={n.id} style={n.read ? {} : { background: '#eef6ff' }}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{n.created_at}</td>
                  <td>{d.branch_name}</td>
                  <td><b>{n.title}</b><div className="muted" style={{ fontSize: '.75rem' }}>{{ purchase: 'Purchase entry', transfer: 'Transfer received', adjustment: 'Stock adjustment' }[d.kind] || 'Stock update'}</div></td>
                  <td>
                    {(d.items || []).map((it, i) => (
                      <div key={i} style={{ fontSize: '.8rem' }}>
                        {it.name} · batch {it.batch_no} · <b style={{ color: 'var(--green, #2e8b3d)' }}>+{it.qty_added}</b> → {it.new_qty} in stock
                      </div>
                    ))}
                  </td>
                  <td>{d.updated_by}</td>
                  <td>{n.read ? <Badge>read</Badge> : <Badge color="orange">unread</Badge>}</td>
                  <td>{!n.read && <button className="btn ghost sm" onClick={() => markRead([n.id])}>✓ Read</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > 50 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center' }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="muted" style={{ alignSelf: 'center' }}>Page {page} of {Math.ceil(total / 50)}</span>
          <button className="btn ghost sm" disabled={page >= Math.ceil(total / 50)} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </Card>
  );
}
