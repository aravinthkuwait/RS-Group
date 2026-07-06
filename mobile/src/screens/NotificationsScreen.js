import React, { useCallback, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useBranch } from '../../App';
import { Chips, Btn, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

export default function NotificationsScreen() {
  const { branchId } = useBranch();
  const [rows, setRows] = useState([]);
  const [view, setView] = useState('all'); // all | stock
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    if (view === 'stock') {
      // Dedicated stock-update history endpoint (paginated), same as web Stock Updates page.
      api('/staff/stock-notifications', { params: { page, limit: 50, branch_id: branchId } })
        .then(d => { setRows(p => page > 1 ? [...p, ...d.notifications] : d.notifications); setTotal(d.total); })
        .catch(() => {});
      return;
    }
    api('/staff/notifications').then(d => { setRows(d.notifications); setTotal(d.notifications.length); }).catch(() => {});
  }, [view, page, branchId]);
  useFocusEffect(load);

  const markAllRead = async () => {
    const unreadIds = rows.filter(n => !n.read).map(n => n.id);
    if (!unreadIds.length) return;
    await api('/staff/notifications/read', { method: 'POST', body: { ids: unreadIds } }).catch(() => {});
    load();
  };

  const exportCsv = () => shareCsv('notifications.csv', [
    { key: 'created_at', label: 'Time' }, { key: 'type', label: 'Type' },
    { key: 'title', label: 'Title' }, { key: 'message', label: 'Message' },
  ], rows);

  const typeIcon = { stock: '📉', stock_update: '📦', expiry: '⏳', task: '📋', purchase: '📦', transfer: '🔁', accounts: '💰', announcement: '📢', info: 'ℹ️' };
  const stockItems = n => {
    if (n.type !== 'stock_update' || !n.data) return null;
    try { return JSON.parse(n.data).items || null; } catch { return null; }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <Chips value={view} onChange={v => { setPage(1); setView(v); }}
        options={[{ value: 'all', label: '🔔 All' }, { value: 'stock', label: '📦 Stock updates' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Btn title="✓ Mark all read" color={colors.green} onPress={markAllRead} /></View>
        <View style={{ flex: 1 }}><Btn title="⬇ Export CSV" color={colors.ink2} onPress={exportCsv} /></View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No notifications</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: item.read ? '#fff' : colors.brandLight, borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <Text style={{ fontWeight: '700' }}>{typeIcon[item.type] || 'ℹ️'} {item.title}</Text>
            {!!item.message && <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>{item.message}</Text>}
            {(stockItems(item) || []).map((it, i) => (
              <Text key={i} style={{ color: colors.green, fontSize: 12, marginTop: 2 }}>
                {it.name} · batch {it.batch_no} · +{it.qty_added} → {it.new_qty} in stock
              </Text>
            ))}
            <Text style={{ color: colors.ink3, fontSize: 11, marginTop: 4 }}>{item.created_at}{item.read ? '' : '  ·  UNREAD'}</Text>
          </View>
        )}
        ListFooterComponent={view === 'stock' && rows.length < total
          ? <Btn title={`Load more (${rows.length}/${total})`} color={colors.brand} onPress={() => setPage(p => p + 1)} />
          : null}
      />
    </View>
  );
}
