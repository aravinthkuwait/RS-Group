import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, ScrollView, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors, shadow } from '../theme';
import { Field, Btn } from '../ui';

const blank = { code: '', name: '', city: '', address: '', phone: '', email: '', gstin: '', drug_license: '', manager: '', active: 1 };

export default function AdminBranchesScreen() {
  const [branches, setBranches] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/admin/branches').then(d => setBranches(d.branches)).catch(() => {});
  }, []);
  useFocusEffect(load);

  const del = () => Alert.alert('Delete branch?', `${edit.name} will be removed (or deactivated if it has data).`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const d = await api(`/admin/branches/${edit.id}`, { method: 'DELETE' });
        if (d.message) Alert.alert('Done', d.message);
        setEdit(null); load();
      } catch (e) { Alert.alert('Could not delete', e.message); }
    } },
  ]);

  const save = async () => {
    if (!edit.name || (!edit.id && !edit.code)) return Alert.alert('Missing details', 'Branch code and name are required.');
    setBusy(true);
    try {
      const body = {
        name: edit.name, city: edit.city, address: edit.address, phone: edit.phone,
        email: edit.email, gstin: edit.gstin, drug_license: edit.drug_license,
        manager: edit.manager, active: edit.active,
      };
      if (edit.id) await api(`/admin/branches/${edit.id}`, { method: 'PUT', body });
      else await api('/admin/branches', { method: 'POST', body: { ...body, code: edit.code } });
      setEdit(null); load();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <Btn title="＋ Add Branch" onPress={() => setEdit({ ...blank })} />
      <FlatList
        data={branches}
        keyExtractor={b => String(b.id)}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => setEdit({ ...blank, ...item })}
            style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, opacity: item.active ? 1 : 0.55 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{item.code} · {item.name}</Text>
              {!item.active && <Text style={{ color: colors.red, fontWeight: '700', fontSize: 11 }}>INACTIVE</Text>}
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.city}{item.phone ? ` · ${item.phone}` : ''}</Text>
            {!!item.manager && <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '600', marginTop: 2 }}>Manager: {item.manager}</Text>}
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!edit} animationType="slide">
        {edit && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{edit.id ? `Edit ${edit.code}` : 'New Branch'}</Text>
            {!edit.id && <Field label="Branch code (e.g. RSG04)" autoCapitalize="characters"
              value={edit.code} onChangeText={v => setEdit(e => ({ ...e, code: v }))} />}
            <Field label="Branch name" value={edit.name} onChangeText={v => setEdit(e => ({ ...e, name: v }))} />
            <Field label="Branch manager" value={edit.manager} onChangeText={v => setEdit(e => ({ ...e, manager: v }))} />
            <Field label="City" value={edit.city} onChangeText={v => setEdit(e => ({ ...e, city: v }))} />
            <Field label="Address" value={edit.address} onChangeText={v => setEdit(e => ({ ...e, address: v }))} />
            <Field label="Phone" keyboardType="phone-pad" value={edit.phone} onChangeText={v => setEdit(e => ({ ...e, phone: v }))} />
            <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={edit.email} onChangeText={v => setEdit(e => ({ ...e, email: v }))} />
            <Field label="GSTIN" autoCapitalize="characters" value={edit.gstin} onChangeText={v => setEdit(e => ({ ...e, gstin: v }))} />
            <Field label="Drug license no." value={edit.drug_license} onChangeText={v => setEdit(e => ({ ...e, drug_license: v }))} />
            {!!edit.id && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontWeight: '700', flex: 1 }}>Active</Text>
                <Switch value={!!edit.active} onValueChange={v => setEdit(e => ({ ...e, active: v ? 1 : 0 }))} />
              </View>
            )}
            <Btn title={busy ? 'Saving…' : '💾 Save Branch'} color={colors.green} onPress={save} disabled={busy} />
            {!!edit.id && <Btn title="🗑 Delete Branch" color={colors.red} onPress={del} />}
            <Btn title="Cancel" color={colors.ink3} onPress={() => setEdit(null)} />
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}
