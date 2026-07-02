import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList } from 'react-native';
import { api, fmt } from '../api';
import { colors, shadow } from '../theme';

export default function CustomersScreen() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const debounce = useRef(null);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      api('/customers', { params: { q } }).then(d => setRows(d.customers)).catch(() => {});
    }, 250);
  }, [q]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <TextInput
        style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 10 }}
        placeholder="Search customer name or mobile…" value={q} onChangeText={setQ} />
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{item.name}</Text>
              <Text style={{ color: colors.brand }}>{Math.round(item.loyalty_points)} ⭐</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.phone} · {item.total_bills} bills · spent {fmt(item.total_spent)}</Text>
            {item.credit_balance > 0 && (
              <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12, marginTop: 2 }}>Credit due: {fmt(item.credit_balance)}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}
