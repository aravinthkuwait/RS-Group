import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api, fmt } from '../api';
import { useBranch } from '../../App';
import { Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

function Stat({ label, value, sub, accent }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 12, flex: 1, minWidth: '30%', borderTopWidth: 3, borderTopColor: accent }, shadow]}>
      <Text style={{ fontSize: 10, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 3 }}>{value}</Text>
      {!!sub && <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

function Badge({ color, children }) {
  return (
    <View style={{ backgroundColor: color, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8, alignSelf: 'flex-start' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{children}</Text>
    </View>
  );
}

function Row({ title, badge, badgeColor, lines }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: badgeColor }, shadow]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '700', flex: 1, marginRight: 6 }} numberOfLines={1}>{title}</Text>
        <Badge color={badgeColor}>{badge}</Badge>
      </View>
      {lines.filter(Boolean).map((l, i) => (
        <Text key={i} style={{ color: colors.ink3, fontSize: 12, marginTop: 2 }}>{l}</Text>
      ))}
    </View>
  );
}

function Section({ title, count, csv, children }) {
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontWeight: '800', flex: 1 }}>{title}{count !== undefined ? ` (${count})` : ''}</Text>
        {csv && <Btn title="⇪ CSV" color={colors.ink2} onPress={csv} />}
      </View>
      {children}
    </View>
  );
}

const Empty = ({ text }) => <Text style={{ color: colors.ink3, textAlign: 'center', marginVertical: 14 }}>{text}</Text>;

export default function ExpiryScreen() {
  const { branchId } = useBranch();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('expiring');

  useEffect(() => {
    setD(null);
    api('/inventory/alerts', { params: { branch_id: branchId } })
      .then(setD).catch(e => Alert.alert('Error', e.message));
  }, [branchId]);

  if (!d) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
        <BranchBar />
        <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.brand} /></View>
      </View>
    );
  }

  const stuck = d.expired.reduce((a, r) => a + r.qty * r.purchase_price, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <Stat accent={colors.red} label="Expired" value={d.expired.length} sub={fmt(stuck) + ' stuck'} />
          <Stat accent={colors.orange} label="Expiring ≤30d" value={d.expiring_30.length} />
          <Stat accent={colors.orange} label="Expiring ≤90d" value={d.expiring_90.length} />
          <Stat accent={colors.red} label="Out of stock" value={d.out_of_stock.length} />
          <Stat accent={colors.orange} label="Low stock" value={d.low_stock.length} />
        </View>

        <Chips value={tab} onChange={setTab} options={[
          { value: 'expiring', label: `⏳ Expiring (${d.expiring_90.length})` },
          { value: 'expired', label: `❌ Expired (${d.expired.length})` },
          { value: 'low', label: `📉 Low / Out (${d.low_stock.length + d.out_of_stock.length})` },
          { value: 'movers', label: '🚀 Movers' },
          { value: 'discount', label: `🏷 Discounts (${d.discount_suggestions.length})` },
        ]} />

        {tab === 'expiring' && (
          <Section title="Batches expiring within 90 days" count={d.expiring_90.length}
            csv={() => shareCsv('expiring-stock', [
              { key: 'medicine_name', label: 'Medicine' }, { key: 'branch_name', label: 'Branch' },
              { key: 'batch_no', label: 'Batch' }, { key: 'expiry_date', label: 'Expiry' },
              { key: 'days_to_expiry', label: 'Days left' }, { key: 'qty', label: 'Qty' },
            ], d.expiring_90)}>
            {d.expiring_90.length === 0 && <Empty text="Nothing expiring soon 🎉" />}
            {d.expiring_90.map(r => (
              <Row key={r.id} title={r.medicine_name}
                badge={`${r.days_to_expiry}d left`} badgeColor={r.days_to_expiry <= 30 ? colors.red : colors.orange}
                lines={[`${r.branch_name} · Batch ${r.batch_no} · Exp ${r.expiry_date}`,
                  `Qty ${r.qty} · Value ${fmt(r.qty * r.purchase_price)}`]} />
            ))}
          </Section>
        )}

        {tab === 'expired' && (
          <Section title="Already expired — remove from shelves" count={d.expired.length}
            csv={() => shareCsv('expired-stock', [
              { key: 'medicine_name', label: 'Medicine' }, { key: 'branch_name', label: 'Branch' },
              { key: 'batch_no', label: 'Batch' }, { key: 'expiry_date', label: 'Expired on' },
              { key: 'days_expired', label: 'Days ago' }, { key: 'qty', label: 'Qty' },
            ], d.expired)}>
            {d.expired.length === 0 && <Empty text="No expired stock 🎉" />}
            {d.expired.map(r => (
              <Row key={r.id} title={r.medicine_name} badge={`${r.days_expired}d ago`} badgeColor={colors.red}
                lines={[`${r.branch_name} · Batch ${r.batch_no} · Expired ${r.expiry_date}`,
                  `Qty ${r.qty} · Value ${fmt(r.qty * r.purchase_price)}`]} />
            ))}
          </Section>
        )}

        {tab === 'low' && (
          <>
            <Section title="Out of stock" count={d.out_of_stock.length}
              csv={() => shareCsv('out-of-stock', [
                { key: 'name', label: 'Medicine' }, { key: 'min_stock', label: 'Min level' },
              ], d.out_of_stock)}>
              {d.out_of_stock.length === 0 && <Empty text="Nothing out of stock 🎉" />}
              {d.out_of_stock.map(r => (
                <Row key={r.id} title={r.name} badge="out of stock" badgeColor={colors.red}
                  lines={[`Min level ${r.min_stock}`]} />
              ))}
            </Section>
            <Section title="Low stock (at or below minimum)" count={d.low_stock.length}
              csv={() => shareCsv('low-stock', [
                { key: 'name', label: 'Medicine' }, { key: 'stock', label: 'In stock' },
                { key: 'min_stock', label: 'Min level' },
              ], d.low_stock)}>
              {d.low_stock.length === 0 && <Empty text="All stock healthy 🎉" />}
              {d.low_stock.map(r => (
                <Row key={r.id} title={r.name} badge="reorder" badgeColor={colors.orange}
                  lines={[`In stock ${r.stock} · Min level ${r.min_stock}`]} />
              ))}
            </Section>
          </>
        )}

        {tab === 'movers' && (
          <>
            <Section title="Fast moving (30 days)" count={d.fast_moving.length}
              csv={() => shareCsv('fast-movers', [
                { key: 'name', label: 'Medicine' }, { key: 'sold_30d', label: 'Sold' },
              ], d.fast_moving)}>
              {d.fast_moving.length === 0 && <Empty text="No sales data yet" />}
              {d.fast_moving.map(r => (
                <Row key={r.id} title={r.name} badge={`${r.sold_30d} sold`} badgeColor={colors.green}
                  lines={[`Sold in last 30 days: ${r.sold_30d} ${r.unit || ''}`]} />
              ))}
            </Section>
            <Section title="Slow moving (≤1 sold in 30 days)" count={d.slow_moving.length}
              csv={() => shareCsv('slow-movers', [
                { key: 'name', label: 'Medicine' }, { key: 'sold_30d', label: 'Sold' },
              ], d.slow_moving)}>
              {d.slow_moving.length === 0 && <Empty text="Everything is moving 🎉" />}
              {d.slow_moving.map(r => (
                <Row key={r.id} title={r.name} badge={`${r.sold_30d} sold`} badgeColor={colors.ink3}
                  lines={[`Sold in last 30 days: ${r.sold_30d} ${r.unit || ''}`]} />
              ))}
            </Section>
          </>
        )}

        {tab === 'discount' && (
          <Section title="Near-expiry discount suggestions" count={d.discount_suggestions.length}
            csv={() => shareCsv('discount-suggestions', [
              { key: 'medicine_name', label: 'Medicine' }, { key: 'branch_name', label: 'Branch' },
              { key: 'batch_no', label: 'Batch' }, { key: 'days_to_expiry', label: 'Days left' },
              { key: 'qty', label: 'Qty' }, { key: 'stock_value', label: 'Value at risk' },
              { key: 'suggested_discount_pct', label: 'Suggested discount %' },
            ], d.discount_suggestions)}>
            {d.discount_suggestions.length === 0 && <Empty text="No near-expiry stock 🎉" />}
            {d.discount_suggestions.map(r => (
              <Row key={r.id} title={r.medicine_name}
                badge={`${r.suggested_discount_pct}% OFF`} badgeColor={colors.brand}
                lines={[
                  `${r.branch_name} · Batch ${r.batch_no} · ${r.days_to_expiry}d left · Qty ${r.qty}`,
                  `Value at risk ${fmt(r.stock_value)} · New price ${fmt(r.selling_price * (1 - r.suggested_discount_pct / 100))}`,
                ]} />
            ))}
          </Section>
        )}
      </ScrollView>
    </View>
  );
}
