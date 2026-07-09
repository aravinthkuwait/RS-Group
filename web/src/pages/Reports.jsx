import React, { useEffect, useState } from 'react';
import { api, fileUrl, fmt, monthStart, today, openAndPrint } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, useToast, Stat } from '../ui.jsx';
import { BarList } from '../charts.jsx';

const REPORT_TABS = [
  { key: 'sales', label: 'Daily / Monthly Sales' },
  { key: 'products', label: 'Product-wise Sales' },
  { key: 'staff', label: 'Staff Sales' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'stock', label: 'Stock (Batch-wise)' },
  { key: 'brands', label: 'Brand-wise Stock' },
  { key: 'generics', label: 'Generic-wise Stock' },
  { key: 'lowstock', label: 'Low Stock' },
  { key: 'expiry', label: 'Expiry' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'gst', label: 'GST / Tax' },
  { key: 'profit', label: 'Profit & Loss' },
];

const DISCOUNT_GROUPS = [
  { key: 'bill', label: 'Bill-wise' },
  { key: 'branch', label: 'Branch-wise' },
  { key: 'user', label: 'User-wise' },
  { key: 'customer', label: 'Customer-wise' },
  { key: 'product', label: 'Product-wise' },
];

export default function Reports() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [key, setKey] = useState('sales');
  const [group, setGroup] = useState('bill'); // discounts report grouping
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [data, setData] = useState(null);
  const [profit, setProfit] = useState(null);

  useEffect(() => {
    setData(null); setProfit(null);
    const params = { ...range, branch_id: branchId, ...(key === 'discounts' ? { group } : {}) };
    if (key === 'profit') {
      api('/reports/profit', { params }).then(setProfit).catch(e => toast(e.message, 'red'));
    } else {
      api(`/reports/${key}`, { params }).then(setData).catch(e => toast(e.message, 'red'));
    }
  }, [key, group, range.from, range.to, branchId]);

  const exportUrl = format => fileUrl(`/reports/${key}/export`, {
    ...range, branch_id: branchId || '', format, ...(key === 'discounts' ? { group } : {}),
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select value={key} onChange={e => setKey(e.target.value)} style={{ minWidth: 220 }}>
            {REPORT_TABS.map(t => <option key={t.key} value={t.key}>{t.label} Report</option>)}
          </select>
          {key === 'discounts' && (
            <select value={group} onChange={e => setGroup(e.target.value)}>
              {DISCOUNT_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          )}
          <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          <div className="spacer" />
          {can(user, 'reports.export') && key !== 'profit' && (
            <>
              <a className="btn red sm" href={exportUrl('pdf')} target="_blank" rel="noreferrer">⬇ PDF</a>
              <a className="btn green sm" href={exportUrl('xlsx')}>⬇ Excel</a>
            </>
          )}
        </div>
      </Card>

      {key === 'profit' && profit && (
        <>
          <div className="stats-row">
            <Stat accent="blue" label="Revenue" value={fmt(profit.revenue)} sub={`Refunds: ${fmt(profit.refunds)}`} />
            <Stat accent="orange" label="Cost of goods" value={fmt(profit.cogs)} />
            <Stat accent="green" label="Gross profit" value={fmt(profit.gross_profit)} />
            <Stat accent="orange" label="Expenses" value={fmt(profit.total_expenses)} />
            <Stat accent={profit.net_profit >= 0 ? 'green' : 'red'} label="Net profit" value={fmt(profit.net_profit)} />
            <Stat accent="blue" label="GST collected" value={fmt(profit.gst_collected)} />
          </div>
          <Card title="Expense breakup">
            <BarList data={profit.expenses.map(e => ({ label: e.category, value: e.total }))} color={2} />
          </Card>
        </>
      )}

      {key !== 'profit' && data && (
        <Card title={`${data.title}${key === 'discounts' ? ` (${DISCOUNT_GROUPS.find(g => g.key === group)?.label})` : ''} · ${data.from ? `${data.from} → ${data.to}` : 'current stock'}`}>
          <div className="toolbar">
            {data.summary.map(([k, v]) => (
              <span key={k} className="badge blue" style={{ fontSize: '.84rem' }}>{k}: <b style={{ marginLeft: 4 }}>{v}</b></span>
            ))}
          </div>
          <Table
            columns={[
              ...data.columns.map(c => ({ key: c.key, label: c.label, num: c.align === 'right' })),
              // Bill-level reports (sales, discounts by-bill) carry sale_id on each row —
              // add a view/print action so a report doubles as a bill lookup.
              ...(can(user, 'billing.view', 'billing.create') && data.rows[0]?.sale_id !== undefined ? [{
                key: '_bill', label: '',
                render: r => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a className="btn ghost sm" href={fileUrl(`/sales/${r.sale_id}/pdf`)} target="_blank" rel="noreferrer">👁 View</a>
                    <button className="btn ghost sm" onClick={() => openAndPrint(fileUrl(`/sales/${r.sale_id}/pdf`))}>🖨 Print</button>
                  </div>
                ),
              }] : []),
            ]}
            rows={data.rows}
          />
        </Card>
      )}
      {key !== 'profit' && !data && <div className="empty">Building report…</div>}
    </div>
  );
}
