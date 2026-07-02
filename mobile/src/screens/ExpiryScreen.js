import React, { useEffect, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { api, fmt } from '../api';
import { colors, shadow } from '../theme';

export default function ExpiryScreen() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/inventory/alerts').then(setD).catch(() => {}); }, []);
  if (!d) return null;
  const rows = [
    ...d.expired.map(r => ({ ...r, tag: 'EXPIRED', color: colors.red })),
    ...d.expiring_90.map(r => ({ ...r, tag: `${r.days_to_expiry}d left`, color: r.days_to_expiry <= 30 ? colors.red : colors.orange })),
  ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <Text style={{ color: colors.ink2, marginBottom: 10 }}>
        {d.expired.length} expired · {d.expiring_30.length} within 30 days · {d.expiring_90.length} within 90 days
      </Text>
      <FlatList
        data={rows}
        keyExtractor={r => `${r.tag}-${r.id}`}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: item.color }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{item.medicine_name}</Text>
              <Text style={{ color: item.color, fontWeight: '800', fontSize: 12 }}>{item.tag}</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {item.branch_name} · Batch {item.batch_no} · Exp {item.expiry_date} · Qty {item.qty} · Value {fmt(item.qty * item.purchase_price)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
