import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, RefreshControl, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, fmt } from '../api';
import { useAuth, can } from '../../App';
import { colors, shadow } from '../theme';

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
  const [d, setD] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    api('/reports/dashboard').then(setD).catch(() => {});
    api('/staff/notifications').then(x => setUnread(x.unread)).catch(() => {});
  }, []);
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

      {can(user, 'dashboard.view') && d && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <StatCard label="Today's sales" value={fmt(d.today.total)} sub={`${d.today.bills} bills`} accent={colors.brand} />
          <StatCard label="This month" value={fmt(d.month.total)} sub={`${d.month.bills} bills`} accent={colors.green} />
          <StatCard label="Low stock" value={String(d.low_stock_count)} sub="items to reorder" accent={colors.orange} />
          <StatCard label="Expiry risk 90d" value={fmt(d.expiry_risk.value)} sub={`${d.expiry_risk.batches} batches`} accent={colors.red} />
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
        <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 16 }, shadow]}>
          <Text style={{ fontWeight: '700', marginBottom: 10 }}>Best sellers (30 days)</Text>
          {d.best_sellers.slice(0, 5).map(b => (
            <View key={b.name} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: colors.ink2, flex: 1 }} numberOfLines={1}>{b.name}</Text>
              <Text style={{ fontWeight: '700' }}>{b.qty} sold</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
