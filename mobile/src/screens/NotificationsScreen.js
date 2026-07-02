import React, { useCallback, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors, shadow } from '../theme';

export default function NotificationsScreen() {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => {
    api('/staff/notifications').then(async d => {
      setRows(d.notifications);
      const unreadIds = d.notifications.filter(n => !n.read).map(n => n.id);
      if (unreadIds.length) await api('/staff/notifications/read', { method: 'POST', body: { ids: unreadIds } }).catch(() => {});
    }).catch(() => {});
  }, []);
  useFocusEffect(load);

  const typeIcon = { stock: '📉', expiry: '⏳', task: '📋', purchase: '📦', transfer: '🔁', accounts: '💰', announcement: '📢', info: 'ℹ️' };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No notifications</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: item.read ? '#fff' : colors.brandLight, borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <Text style={{ fontWeight: '700' }}>{typeIcon[item.type] || 'ℹ️'} {item.title}</Text>
            {!!item.message && <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>{item.message}</Text>}
            <Text style={{ color: colors.ink3, fontSize: 11, marginTop: 4 }}>{item.created_at}</Text>
          </View>
        )}
      />
    </View>
  );
}
