import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, fmt } from '../api';
import { colors, shadow } from '../theme';

export default function DeliveriesScreen() {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => {
    api('/sales/deliveries/list').then(d => setRows(d.deliveries)).catch(() => {});
  }, []);
  useFocusEffect(load);

  const update = async (item, status) => {
    try {
      await api(`/sales/${item.id}/delivery`, { method: 'POST', body: { status } });
      load();
    } catch (e) { Alert.alert('Error', e.message); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No deliveries assigned</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{item.invoice_no}</Text>
              <Text style={{ fontWeight: '800', color: colors.green }}>{fmt(item.total)}</Text>
            </View>
            <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>
              {item.customer_name} · {item.customer_phone}
            </Text>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.delivery_address}</Text>
            <Text style={{ color: colors.orange, fontWeight: '700', fontSize: 12, marginVertical: 4 }}>
              {String(item.delivery_status).replace(/_/g, ' ').toUpperCase()}
            </Text>
            {item.delivery_status !== 'delivered' && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {item.delivery_status === 'pending' && (
                  <TouchableOpacity onPress={() => update(item, 'out_for_delivery')} style={s.btn(colors.brand)}>
                    <Text style={s.btnT}>Pick up</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => update(item, 'delivered')} style={s.btn(colors.green)}>
                  <Text style={s.btnT}>Delivered ✓</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => update(item, 'failed')} style={s.btn(colors.red)}>
                  <Text style={s.btnT}>Failed</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const s = {
  btn: bg => ({ backgroundColor: bg, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 }),
  btnT: { color: '#fff', fontWeight: '700', fontSize: 12 },
};
