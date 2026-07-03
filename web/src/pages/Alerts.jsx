import React, { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { useBranch } from '../App.jsx';
import { Card, Table, Tabs, Badge, Stat, useToast, ExportBtn } from '../ui.jsx';

export default function Alerts() {
  const { branchId } = useBranch();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('expiring');

  useEffect(() => {
    api('/inventory/alerts', { params: { branch_id: branchId } })
      .then(setD).catch(e => toast(e.message, 'red'));
  }, [branchId]);

  if (!d) return <div className="empty">Checking stock…</div>;

  const expiryCols = [
    { key: 'medicine_name', label: 'Medicine' },
    { key: 'branch_name', label: 'Branch' },
    { key: 'batch_no', label: 'Batch' },
    { key: 'expiry_date', label: 'Expiry' },
    { key: 'days_to_expiry', label: 'Days left', num: true, render: r => <Badge color={r.days_to_expiry <= 30 ? 'red' : 'orange'}>{r.days_to_expiry}d</Badge> },
    { key: 'qty', label: 'Qty', num: true },
    { label: 'Value', num: true, render: r => fmt(r.qty * r.purchase_price) },
  ];

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="stats-row">
        <Stat accent="red" label="Expired batches" value={d.expired.length} sub={fmt(d.expired.reduce((a, r) => a + r.qty * r.purchase_price, 0)) + ' stuck'} />
        <Stat accent="orange" label="Expiring ≤ 30 days" value={d.expiring_30.length} />
        <Stat accent="orange" label="Expiring ≤ 90 days" value={d.expiring_90.length} />
        <Stat accent="red" label="Out of stock" value={d.out_of_stock.length} />
        <Stat accent="orange" label="Low stock" value={d.low_stock.length} />
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'expiring', label: `⏳ Expiring (${d.expiring_90.length})` },
        { key: 'expired', label: `❌ Expired (${d.expired.length})` },
        { key: 'low', label: `📉 Low / Out of stock (${d.low_stock.length + d.out_of_stock.length})` },
        { key: 'movers', label: '🚀 Fast & Slow movers' },
        { key: 'discount', label: `🏷 Discount suggestions (${d.discount_suggestions.length})` },
      ]} />

      {tab === 'expiring' && (
        <Card title="Batches expiring within 90 days"
          actions={<ExportBtn name="expiring-stock" rows={d.expiring_90} columns={[
            { key: 'medicine_name', label: 'Medicine' }, { key: 'branch_name', label: 'Branch' },
            { key: 'batch_no', label: 'Batch' }, { key: 'expiry_date', label: 'Expiry' },
            { key: 'days_to_expiry', label: 'Days left' }, { key: 'qty', label: 'Qty' },
          ]} />}>
          <Table columns={expiryCols} rows={d.expiring_90} keyFn={r => r.id} empty="Nothing expiring soon 🎉" />
        </Card>
      )}
      {tab === 'expired' && (
        <Card title="Already expired — remove from shelves and write off"
          actions={<ExportBtn name="expired-stock" rows={d.expired} columns={[
            { key: 'medicine_name', label: 'Medicine' }, { key: 'branch_name', label: 'Branch' },
            { key: 'batch_no', label: 'Batch' }, { key: 'expiry_date', label: 'Expired on' },
            { key: 'days_expired', label: 'Days ago' }, { key: 'qty', label: 'Qty' },
          ]} />}>
          <Table columns={[
            { key: 'medicine_name', label: 'Medicine' },
            { key: 'branch_name', label: 'Branch' },
            { key: 'batch_no', label: 'Batch' },
            { key: 'expiry_date', label: 'Expired on' },
            { key: 'days_expired', label: 'Days ago', num: true },
            { key: 'qty', label: 'Qty', num: true },
            { label: 'Value', num: true, render: r => fmt(r.qty * r.purchase_price) },
          ]} rows={d.expired} keyFn={r => r.id} empty="No expired stock 🎉" />
        </Card>
      )}
      {tab === 'low' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <Card title="Out of stock"
            actions={<ExportBtn name="out-of-stock" rows={d.out_of_stock} columns={[
              { key: 'name', label: 'Medicine' }, { key: 'min_stock', label: 'Min level' },
            ]} />}>
            <Table columns={[
              { key: 'name', label: 'Medicine' },
              { key: 'min_stock', label: 'Min level', num: true },
              { label: 'Status', render: () => <Badge color="red">out of stock</Badge> },
            ]} rows={d.out_of_stock} empty="Nothing out of stock 🎉" />
          </Card>
          <Card title="Low stock (at or below minimum)"
            actions={<ExportBtn name="low-stock" rows={d.low_stock} columns={[
              { key: 'name', label: 'Medicine' }, { key: 'stock', label: 'In stock' },
              { key: 'min_stock', label: 'Min level' },
            ]} />}>
            <Table columns={[
              { key: 'name', label: 'Medicine' },
              { key: 'stock', label: 'In stock', num: true },
              { key: 'min_stock', label: 'Min level', num: true },
              { label: 'Status', render: () => <Badge color="orange">reorder</Badge> },
            ]} rows={d.low_stock} empty="All stock healthy 🎉" />
          </Card>
        </div>
      )}
      {tab === 'movers' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <Card title="Fast moving (30 days)">
            <Table columns={[
              { key: 'name', label: 'Medicine' },
              { key: 'sold_30d', label: 'Sold', num: true },
            ]} rows={d.fast_moving} empty="No sales data yet" />
          </Card>
          <Card title="Slow moving (≤1 sold in 30 days)">
            <Table columns={[
              { key: 'name', label: 'Medicine' },
              { key: 'sold_30d', label: 'Sold', num: true },
            ]} rows={d.slow_moving} empty="Everything is moving 🎉" />
          </Card>
        </div>
      )}
      {tab === 'discount' && (
        <Card title="Near-expiry discount suggestions — clear stock before it expires"
          actions={<ExportBtn name="discount-suggestions" rows={d.discount_suggestions} columns={[
            { key: 'medicine_name', label: 'Medicine' }, { key: 'branch_name', label: 'Branch' },
            { key: 'batch_no', label: 'Batch' }, { key: 'days_to_expiry', label: 'Days left' },
            { key: 'qty', label: 'Qty' }, { key: 'stock_value', label: 'Value at risk' },
            { key: 'suggested_discount_pct', label: 'Suggested discount %' },
          ]} />}>
          <Table columns={[
            { key: 'medicine_name', label: 'Medicine' },
            { key: 'branch_name', label: 'Branch' },
            { key: 'batch_no', label: 'Batch' },
            { key: 'days_to_expiry', label: 'Days left', num: true },
            { key: 'qty', label: 'Qty', num: true },
            { key: 'stock_value', label: 'Value at risk', num: true, render: r => fmt(r.stock_value) },
            { key: 'suggested_discount_pct', label: 'Suggested discount', num: true, render: r => <Badge color="blue">{r.suggested_discount_pct}% OFF</Badge> },
            { label: 'New price', num: true, render: r => fmt(r.selling_price * (1 - r.suggested_discount_pct / 100)) },
          ]} rows={d.discount_suggestions} keyFn={r => r.id} empty="No near-expiry stock 🎉" />
        </Card>
      )}
    </div>
  );
}
