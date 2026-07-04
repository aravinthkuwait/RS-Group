import React, { useEffect, useState } from 'react';
import { api, fmt0 } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Stat } from '../ui.jsx';
import { LineChart, Bars, BarList, Donut } from '../charts.jsx';
import { ConnectionStatus } from '../ConnectionStatus.jsx';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { user } = useAuth();
  const { branchId, branchName, canSwitch } = useBranch();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/reports/dashboard', { params: { branch_id: branchId } })
      .then(setD).catch(e => setErr(e.message));
  }, [branchId]);

  if (err) return <div className="err-msg">{err}</div>;
  if (!d) return <div className="empty">Loading dashboard…</div>;

  const trend = d.trend.map(t => ({ label: t.date.slice(5), sales: t.total }));
  const monthly = d.monthly.map(m => ({ label: m.month.slice(2), sales: m.total, profit: m.profit }));
  const paySplit = [
    { label: 'Cash', value: d.month.cash }, { label: 'UPI', value: d.month.upi },
    { label: 'Card', value: d.month.card }, { label: 'Credit', value: d.month.credit },
  ];

  return (
    <div className="grid" style={{ gap: 18 }}>
      <ConnectionStatus />
      <div className="stats-row">
        <Stat accent="blue" label="Today's Sales" value={fmt0(d.today.total)} sub={`${d.today.bills} bills`} />
        <Stat accent="green" label="This Month" value={fmt0(d.month.total)} sub={`${d.month.bills} bills`} />
        <Stat accent="green" label="Est. Profit (Month)" value={fmt0(d.month.profit)} sub={`Net after expenses: ${fmt0(d.month_profit_net)}`} />
        <Stat accent="orange" label="Stock Value" value={fmt0(d.stock_value.cost)} sub={`Retail: ${fmt0(d.stock_value.retail)}`} />
        <Stat accent="red" label="Expiry Risk (90d)" value={fmt0(d.expiry_risk.value)} sub={`${d.expiry_risk.batches} batches · ${d.expired.batches} already expired`} />
        <Stat accent="orange" label="Low Stock Items" value={d.low_stock_count} sub={<Link to="/alerts">View alerts →</Link>} />
      </div>

      {/* Expiry & batch widgets */}
      <div className="stats-row">
        <Stat accent="orange" label="Expiring in 30 Days" value={d.expiring_30?.batches ?? 0} sub={`${fmt0(d.expiring_30?.value || 0)} at risk`} />
        <Stat accent="orange" label="Expiring in 60 Days" value={d.expiring_60?.batches ?? 0} sub={`${fmt0(d.expiring_60?.value || 0)} at risk`} />
        <Stat accent="red" label="Expiring in 90 Days" value={d.expiring_90?.batches ?? 0} sub={`${fmt0(d.expiring_90?.value || 0)} at risk`} />
        <Stat accent="red" label="Expired Stock" value={d.expired?.batches ?? 0} sub={<Link to="/alerts">{fmt0(d.expired?.value || 0)} · view →</Link>} />
        <Stat accent="blue" label="Batch-wise Stock" value={d.batch_summary?.batches ?? 0} sub={`${d.batch_summary?.units ?? 0} units · ${d.batch_summary?.medicines ?? 0} medicines`} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
        <Card title="Sales — last 14 days">
          {trend.length ? <LineChart data={trend} series={[{ key: 'sales', name: 'Sales' }]} /> : <div className="empty">No sales yet</div>}
        </Card>
        <Card title="Payment collection (this month)">
          <Donut data={paySplit} />
          <div className="muted" style={{ marginTop: 8 }}>
            Customer credit dues: <b>{fmt0(d.customer_dues)}</b> · Supplier dues: <b>{fmt0(d.supplier_dues)}</b>
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
        <Card title="Monthly sales vs profit (6 months)">
          {monthly.length ? <Bars data={monthly} series={[{ key: 'sales', name: 'Sales' }, { key: 'profit', name: 'Profit' }]} /> : <div className="empty">No data</div>}
        </Card>
        {(canSwitch || can(user, 'dashboard.all_branches')) && (
          <Card title="Branch-wise sales (this month)">
            <BarList data={d.branch_wise.map(b => ({ label: `${b.name}`, value: b.total, sub: `${b.bills} bills` }))} />
            <div className="muted" style={{ marginTop: 10, fontWeight: 600 }}>Stock value by branch</div>
            <div style={{ marginTop: 8 }}>
              <BarList data={d.stock_by_branch.map(b => ({ label: b.name, value: b.value }))} color={2} />
            </div>
          </Card>
        )}
        <Card title="Best-selling medicines (30 days)">
          <BarList data={d.best_sellers.map(b => ({ label: b.name, value: b.amount, sub: `${b.qty} sold` }))} color={1} />
        </Card>
        <Card title="Staff performance (this month)">
          <BarList data={d.staff_performance.map(s => ({ label: s.name, value: s.total, sub: `${s.bills} bills` }))} />
        </Card>
        <Card title="Brand-wise sales (30 days)">
          {d.top_brands?.length ? <BarList data={d.top_brands.map(b => ({ label: b.name, value: b.amount, sub: `${b.qty} sold` }))} color={2} />
            : <div className="empty">No sales yet</div>}
        </Card>
        <Card title="Generic-wise sales (30 days)">
          {d.top_generics?.length ? <BarList data={d.top_generics.map(g => ({ label: g.name, value: g.amount, sub: `${g.qty} sold` }))} color={1} />
            : <div className="empty">No sales yet</div>}
        </Card>
      </div>
    </div>
  );
}
