import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, Alert } from 'react-native';
import { api, fmt } from '../api';
import { useAuth, can } from '../../App';
import { colors, shadow } from '../theme';

export default function StockScreen() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const debounce = useRef(null);

  const load = () => api('/inventory/stock', { params: { q } }).then(d => setRows(d.stock)).catch(() => {});
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
  }, [q]);

  const adjust = item => {
    if (!can(user, 'inventory.adjust')) return;
    Alert.prompt?.(
      `Adjust ${item.medicine_name}`,
      `Batch ${item.batch_no} — current qty ${item.qty}. Enter +/- change:`,
      async text => {
        const change = Number(text);
        if (!change) return;
        try {
          await api('/inventory/adjustments', { method: 'POST', body: { batch_id: item.id, qty_change: change, reason: 'Mobile stock update' } });
          load();
        } catch (e) { Alert.alert('Error', e.message); }
      },
    ) || Alert.alert('Stock update', 'Use the web app for adjustments on this device.');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <TextInput
        style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 10 }}
        placeholder="Search stock by medicine or batch…" value={q} onChangeText={setQ} />
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        renderItem={({ item }) => (
          <TouchableOpacity onLongPress={() => adjust(item)}
            style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{item.medicine_name}</Text>
              <Text style={{
                fontWeight: '800',
                color: item.qty <= item.min_stock ? colors.orange : colors.green,
              }}>{item.qty} {item.unit}</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 2 }}>
              {item.branch_code} · Batch {item.batch_no} · Exp {item.expiry_date}
              {item.days_to_expiry < 0 ? ' ⚠️ EXPIRED' : item.days_to_expiry <= 90 ? ` · ${item.days_to_expiry}d left` : ''}
            </Text>
            <Text style={{ color: colors.ink2, fontSize: 12 }}>MRP {fmt(item.mrp)} · Selling {fmt(item.selling_price)} · Rack {item.rack_location}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
