import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
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
      // Fetch page 1..N in one request and REPLACE rows — refocus/mark-all-read
      // re-runs load, and appending would duplicate already-loaded pages.
      api('/staff/stock-notifications', { params: { page: 1, limit: 50 * page, branch_id: branchId } })
        .then(d => { setRows(d.notifications); setTotal(d.total); })
        .catch(() => {});
      return;
    }
    api('/staff/notifications').then(d => { setRows(d.notifications); setTotal(d.notifications.length); }).catch(() => {});
  }, [view, page, branchId]);
  useFocusEffect(load);

  const markRead = async (ids) => {
    if (!ids.length) return;
    await api('/staff/notifications/read', { method: 'POST', body: { ids } }).catch(() => {});
    load();
  };

  const markAllRead = () => markRead(rows.filter(n => !n.read).map(n => n.id));

  const parseData = n => { try { return JSON.parse(n.data || '{}'); } catch { return {}; } };

  const exportCsv = async () => {
    if (view === 'stock') {
      const d = await api('/staff/stock-notifications', { params: { page: 1, limit: 100000, branch_id: branchId } }).catch(() => null);
      const flat = (d?.notifications || []).flatMap(n => {
        const x = parseData(n);
        return (x.items || []).map(it => ({
          date: n.created_at, branch: x.branch_name, item: it.name, batch: it.batch_no,
          qty_added: it.qty_added, new_qty: it.new_qty, updated_by: x.updated_by,
          status: n.read ? 'Read' : 'Unread',
        }));
      });
      return shareCsv('stock-updates.csv', [
        { key: 'date', label: 'Date' }, { key: 'branch', label: 'Branch' }, { key: 'item', label: 'Item' },
        { key: 'batch', label: 'Batch' }, { key: 'qty_added', label: 'Qty Added' },
        { key: 'new_qty', label: 'Updated Stock' }, { key: 'updated_by', label: 'Updated By' },
        { key: 'status', label: 'Status' },
      ], flat);
    }
    return shareCsv('notifications.csv', [
      { key: 'created_at', label: 'Time' }, { key: 'type', label: 'Type' },
      { key: 'title', label: 'Title' }, { key: 'message', label: 'Message' },
    ], rows);
  };

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
        <View style={{ flex: 1 }}><Btn title="✓ Mark all read" color={colors.green} onPress={markAllRead} disabled={!rows.some(n => !n.read)} /></View>
        <View style={{ flex: 1 }}><Btn title="⬇ Export CSV" color={colors.ink2} onPress={exportCsv} /></View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>
          {view === 'stock' ? 'No stock updates yet. They appear here whenever stock is added by purchase, transfer or adjustment.' : 'No notifications'}
        </Text>}
        renderItem={({ item }) => {
          const d = parseData(item);
          return (
            <TouchableOpacity disabled={item.read} onPress={() => markRead([item.id])}
              style={[{ backgroundColor: item.read ? '#fff' : colors.brandLight, borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
              <Text style={{ fontWeight: '700' }}>{typeIcon[item.type] || 'ℹ️'} {item.title}</Text>
              {!!item.message && <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>{item.message}</Text>}
              {!!(d.branch_name || d.updated_by) && (
                <Text style={{ color: colors.ink2, fontSize: 12, marginTop: 2 }}>{d.branch_name}{d.branch_name && d.updated_by ? ' · updated by ' : d.updated_by ? 'updated by ' : ''}{d.updated_by}</Text>
              )}
              {(stockItems(item) || []).map((it, i) => (
                <Text key={i} style={{ color: colors.green, fontSize: 12, marginTop: 2 }}>
                  {it.name} · batch {it.batch_no} · +{it.qty_added} → {it.new_qty} in stock
                </Text>
              ))}
              <Text style={{ color: colors.ink3, fontSize: 11, marginTop: 4 }}>{item.created_at}{item.read ? '' : '  ·  UNREAD  ·  tap to mark read'}</Text>
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={view === 'stock' && rows.length < total
          ? <Btn title={`Load more (${rows.length}/${total})`} color={colors.brand} onPress={() => setPage(p => p + 1)} />
          : null}
      />
    </View>
  );
}
