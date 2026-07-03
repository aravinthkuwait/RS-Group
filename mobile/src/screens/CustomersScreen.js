import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Modal, ScrollView, Alert } from 'react-native';
import { api, fmt } from '../api';
import { useAuth, can } from '../../App';
import { colors, shadow } from '../theme';
import { Field, Chips, Btn } from '../ui';

const blank = { name: '', phone: '', address: '', gstin: '', customer_type: 'individual' };

export default function CustomersScreen() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const debounce = useRef(null);

  const load = () => api('/customers', { params: { q } }).then(d => setRows(d.customers)).catch(() => {});
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
  }, [q]);

  const save = async () => {
    if (!edit.name || !edit.phone) return Alert.alert('Missing details', 'Name and mobile number are required.');
    setBusy(true);
    try {
      await api('/customers', { method: 'POST', body: edit });
      setEdit(null); load();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      {can(user, 'customers.manage') && <Btn title="＋ New Customer" onPress={() => setEdit({ ...blank })} />}
      <TextInput
        style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 10 }}
        placeholder="Search customer name or mobile…" value={q} onChangeText={setQ} />
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>
                {item.name}
                {item.customer_type === 'business' && <Text style={{ color: colors.orange, fontSize: 11 }}>  BUSINESS</Text>}
              </Text>
              <Text style={{ color: colors.brand }}>{Math.round(item.loyalty_points)} ⭐</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.phone} · {item.total_bills} bills · spent {fmt(item.total_spent)}</Text>
            {!!item.gstin && <Text style={{ color: colors.ink3, fontSize: 12 }}>GST: {item.gstin}</Text>}
            {item.credit_balance > 0 && (
              <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12, marginTop: 2 }}>Credit due: {fmt(item.credit_balance)}</Text>
            )}
          </View>
        )}
      />

      <Modal visible={!!edit} animationType="slide">
        {edit && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>New Customer</Text>
            <Field label="Full name" value={edit.name} onChangeText={v => setEdit(e => ({ ...e, name: v }))} />
            <Field label="Mobile number" keyboardType="phone-pad" value={edit.phone} onChangeText={v => setEdit(e => ({ ...e, phone: v }))} />
            <Field label="Address" value={edit.address} onChangeText={v => setEdit(e => ({ ...e, address: v }))} />
            <Chips label="Customer type" value={edit.customer_type} onChange={v => setEdit(e => ({ ...e, customer_type: v }))}
              options={[{ value: 'individual', label: 'Individual' }, { value: 'business', label: 'Business (GST)' }]} />
            {edit.customer_type === 'business' && (
              <Field label="GST number (GSTIN)" autoCapitalize="characters" value={edit.gstin} onChangeText={v => setEdit(e => ({ ...e, gstin: v }))} />
            )}
            <Btn title={busy ? 'Saving…' : '💾 Save Customer'} color={colors.green} onPress={save} disabled={busy} />
            <Btn title="Cancel" color={colors.ink3} onPress={() => setEdit(null)} />
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}
