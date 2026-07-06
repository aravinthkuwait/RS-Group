import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, RefreshControl, TouchableOpacity, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, fmt } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { colors, shadow } from '../theme';
import { BranchBar } from '../ui';
import { useConnectivity, humanDuration } from '../useConnectivity';

const fmtTime = ts => new Date(ts).toLocaleString('en-IN', { hour12: true });

function ConnectionCard() {
  const { online, since, history } = useConnectivity();
  const [log, setLog] = useState(false);
  const up = online === true;
  const pending = online === null;
  const color = pending ? colors.orange : up ? colors.green : colors.red;
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14 }, shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '800' }}>
            {pending ? 'Checking connection…' : up ? '🟢 Online — server connected' : '🔴 Offline — no server'}
          </Text>
          {!pending && (
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {up ? 'Online' : 'Offline'} for {humanDuration(Date.now() - since)} · since {fmtTime(since)}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => setLog(true)}>
          <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>History ({history.length})</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={log} animationType="slide" onRequestClose={() => setLog(false)}>
        <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16, paddingTop: 40 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>Connection history</Text>
          <ScrollView>
            {history.length === 0 && <Text style={{ color: colors.ink3 }}>No status changes recorded yet.</Text>}
            {history.map((h, i) => (
              <View key={i} style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: h.status === 'online' ? colors.green : colors.red }, shadow]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: h.status === 'online' ? colors.green : colors.red }}>{h.status.toUpperCase()}</Text>
                  <Text style={{ fontWeight: '700' }}>{humanDuration((h.end || Date.now()) - h.start)}</Text>
                </View>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>{fmtTime(h.start)} → {h.end ? fmtTime(h.end) : 'now'}</Text>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={() => setLog(false)} style={{ backgroundColor: colors.brand, borderRadius: 10, padding: 14, marginTop: 8 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

function Section({ title, children }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 16 }, shadow]}>
      <Text style={{ fontWeight: '700', marginBottom: 10 }}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ l, r, bold, red }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={{ color: colors.ink2, flex: 1, fontWeight: bold ? '800' : '400' }} numberOfLines={1}>{l}</Text>
      <Text style={{ fontWeight: '700', color: red ? colors.red : colors.ink }}>{r}</Text>
    </View>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14, flex: 1, minWidth: '46%', borderTopWidth: 3, borderTopColor: accent }, shadow]}>
      <Text style={{ fontSize: 11, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 4 }}>{value}</Text>
      {!!sub && <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const [d, setD] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    api('/reports/dashboard', { params: { branch_id: branchId } }).then(setD).catch(() => {});
    api('/staff/notifications').then(x => setUnread(x.unread)).catch(() => {});
  }, [branchId]);
  useFocusEffect(load);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 14, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); setRefreshing(false); }} />}
    >
      <View style={[{ backgroundColor: colors.brand, borderRadius: 14, padding: 16 }, shadow]}>
        <Text style={{ color: '#cfe0f5', fontSize: 12 }}>Welcome back</Text>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{user.name}</Text>
        <Text style={{ color: '#9fb6d6', fontSize: 12, marginTop: 2 }}>
          {user.role.replace(/_/g, ' ')} · {user.branch?.name || 'All branches'}
        </Text>
        <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ position: 'absolute', right: 14, top: 14 }}>
          <Text style={{ fontSize: 20 }}>🔔</Text>
          {unread > 0 && (
            <View style={{ position: 'absolute', top: -6, right: -8, backgroundColor: colors.red, borderRadius: 9, paddingHorizontal: 5 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ConnectionCard />

      <BranchBar />

      {can(user, 'dashboard.view') && d && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <StatCard label="Today's sales" value={fmt(d.today.total)} sub={`${d.today.bills} bills`} accent={colors.brand} />
          <StatCard label="This month" value={fmt(d.month.total)} sub={`${d.month.bills} bills`} accent={colors.green} />
          <StatCard label="Est. profit (month)" value={fmt(d.month.profit)} sub={`${fmt(d.month_profit_net)} after expenses`} accent={colors.green} />
          <StatCard label="Stock value" value={fmt(d.stock_value.cost)} sub={`retail ${fmt(d.stock_value.retail)}`} accent={colors.brand} />
          <StatCard label="Low stock" value={String(d.low_stock_count)} sub="items to reorder" accent={colors.orange} />
          <StatCard label="Expiry risk 90d" value={fmt(d.expiry_risk.value)} sub={`${d.expiry_risk.batches} batches`} accent={colors.red} />
          <StatCard label="Expiring 30d" value={fmt(d.expiring_30.value)} sub={`${d.expiring_30.batches} batches`} accent={colors.red} />
          <StatCard label="Expiring 60d" value={fmt(d.expiring_60.value)} sub={`${d.expiring_60.batches} batches`} accent={colors.orange} />
          <StatCard label="Expired stock" value={fmt(d.expired.value)} sub={`${d.expired.batches} batches`} accent={colors.red} />
          <StatCard label="Batch stock" value={String(d.batch_summary.batches)} sub={`${d.batch_summary.units} units · ${d.batch_summary.medicines} medicines`} accent={colors.brand} />
        </View>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[
          can(user, 'inventory.view') && { t: '⏳ Expiry Check', nav: 'Expiry' },
          can(user, 'customers.view') && { t: '👥 Customers', nav: 'Customers' },
          can(user, 'delivery.view') && { t: '🛵 Deliveries', nav: 'Deliveries' },
          { t: '📋 My Tasks', nav: 'Tasks' },
          { t: '🕐 Attendance', nav: 'Attendance' },
        ].filter(Boolean).map(x => (
          <TouchableOpacity key={x.t} onPress={() => navigation.navigate(x.nav)}
            style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 16, flex: 1, minWidth: '46%' }, shadow]}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{x.t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {d && can(user, 'dashboard.view') && (
        <>
          <Section title="Payment collection (today)">
            <Row l="Cash" r={fmt(d.today.cash)} />
            <Row l="UPI" r={fmt(d.today.upi)} />
            <Row l="Card" r={fmt(d.today.card)} />
            <Row l="Credit (unpaid)" r={fmt(d.today.credit)} />
            <Row l="Customer dues" r={fmt(d.customer_dues)} red={d.customer_dues > 0} />
            <Row l="Supplier dues" r={fmt(d.supplier_dues)} red={d.supplier_dues > 0} />
          </Section>

          {(d.monthly || []).length > 0 && (
            <Section title="Monthly sales vs profit (6 months)">
              {d.monthly.map(m => (
                <Row key={m.month} l={m.month} r={`${fmt(m.total)} · profit ${fmt(m.profit)}`} />
              ))}
            </Section>
          )}

          {(d.branch_wise || []).length > 1 && (
            <Section title="Branch-wise sales (this month)">
              {d.branch_wise.map(b => <Row key={b.code} l={`${b.code} · ${b.name}`} r={`${fmt(b.total)} · ${b.bills} bills`} />)}
            </Section>
          )}

          {(d.stock_by_branch || []).length > 1 && (
            <Section title="Stock value by branch">
              {d.stock_by_branch.map(b => <Row key={b.code} l={`${b.code} · ${b.name}`} r={fmt(b.value)} />)}
            </Section>
          )}

          <Section title="Best sellers (30 days)">
            {d.best_sellers.slice(0, 8).map(b => (
              <Row key={b.name} l={b.name} r={`${b.qty} sold · ${fmt(b.amount)}`} />
            ))}
          </Section>

          {(d.staff_performance || []).length > 0 && (
            <Section title="Staff performance (this month)">
              {d.staff_performance.map(x => <Row key={x.name} l={x.name} r={`${fmt(x.total)} · ${x.bills} bills`} />)}
            </Section>
          )}

          {(d.top_brands || []).length > 0 && (
            <Section title="Brand-wise sales (30 days)">
              {d.top_brands.map(x => <Row key={x.name} l={x.name} r={`${fmt(x.amount)} · ${x.qty} qty`} />)}
            </Section>
          )}

          {(d.top_generics || []).length > 0 && (
            <Section title="Generic-wise sales (30 days)">
              {d.top_generics.map(x => <Row key={x.name} l={x.name} r={`${fmt(x.amount)} · ${x.qty} qty`} />)}
            </Section>
          )}
        </>
      )}
    </ScrollView>
  );
}
