import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, ScrollView, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth } from '../../App';
import { colors, shadow } from '../theme';
import { Field, Chips, Btn } from '../ui';

const blank = { name: '', email: '', phone: '', password: '', role: 'billing_staff', branch_id: null, extra_branches: [], active: 1 };

export default function AdminUsersScreen() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [edit, setEdit] = useState(null); // null = closed, {id?} = modal open
  const [busy, setBusy] = useState(false);
  const isOwner = me.role === 'super_admin';

  const load = useCallback(() => {
    api('/admin/users').then(d => { setUsers(d.users); setRoles(d.roles); }).catch(() => {});
    api('/admin/branches').then(d => setBranches(d.branches.filter(b => b.active))).catch(() => {});
  }, []);
  useFocusEffect(load);

  const save = async () => {
    if (!edit.name || (!edit.id && (!edit.email || !edit.password))) {
      return Alert.alert('Missing details', 'Name, email and password are required for a new user.');
    }
    setBusy(true);
    try {
      if (edit.id) {
        await api(`/admin/users/${edit.id}`, { method: 'PUT', body: {
          name: edit.name, phone: edit.phone, role: edit.role, branch_id: edit.branch_id,
          active: edit.active, extra_branches: edit.extra_branches,
          ...(edit.password ? { password: edit.password } : {}),
        } });
      } else {
        await api('/admin/users', { method: 'POST', body: {
          name: edit.name, email: edit.email, phone: edit.phone, password: edit.password,
          role: edit.role, branch_id: edit.branch_id, extra_branches: edit.extra_branches,
        } });
      }
      setEdit(null); load();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  const del = () => Alert.alert('Delete user?', `${edit.name} will be removed (or deactivated if they have billing history).`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const d = await api(`/admin/users/${edit.id}`, { method: 'DELETE' });
        if (d.message) Alert.alert('Done', d.message);
        setEdit(null); load();
      } catch (e) { Alert.alert('Could not delete', e.message); }
    } },
  ]);

  const openEdit = u => setEdit({
    id: u.id, name: u.name, email: u.email, phone: u.phone || '', password: '',
    role: u.role, branch_id: u.branch_id, active: u.active,
    extra_branches: (() => { try { return JSON.parse(u.extra_branches || '[]'); } catch { return []; } })(),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <Btn title="＋ Add User" onPress={() => setEdit({ ...blank, branch_id: me.branch_id || branches[0]?.id || null })} />
      <FlatList
        data={users}
        keyExtractor={u => String(u.id)}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => openEdit(item)}
            style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, opacity: item.active ? 1 : 0.55 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{item.name}</Text>
              {!item.active && <Text style={{ color: colors.red, fontWeight: '700', fontSize: 11 }}>INACTIVE</Text>}
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.email}</Text>
            <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '600', marginTop: 2 }}>
              {item.role.replace(/_/g, ' ')} · {item.branch_name || 'All branches'}
            </Text>
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!edit} animationType="slide">
        {edit && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{edit.id ? 'Edit User' : 'New User'}</Text>
            <Field label="Full name" value={edit.name} onChangeText={v => setEdit(e => ({ ...e, name: v }))} />
            {!edit.id && <Field label="Email (login)" autoCapitalize="none" keyboardType="email-address"
              value={edit.email} onChangeText={v => setEdit(e => ({ ...e, email: v }))} />}
            <Field label="Phone" keyboardType="phone-pad" value={edit.phone} onChangeText={v => setEdit(e => ({ ...e, phone: v }))} />
            <Field label={edit.id ? 'New password (leave blank to keep)' : 'Password'} secureTextEntry
              value={edit.password} onChangeText={v => setEdit(e => ({ ...e, password: v }))} />
            <Chips label="Role" value={edit.role} onChange={v => setEdit(e => ({ ...e, role: v }))}
              options={roles.filter(r => isOwner || r !== 'super_admin').map(r => ({ value: r, label: r.replace(/_/g, ' ') }))} />
            {isOwner && (
              <Chips label="Primary branch" value={edit.branch_id} onChange={v => setEdit(e => ({ ...e, branch_id: v, extra_branches: e.extra_branches.filter(b => b !== v) }))}
                options={branches.map(b => ({ value: b.id, label: b.name }))} />
            )}
            {isOwner && !['super_admin', 'auditor'].includes(edit.role) && (
              <Chips label="Also works at (multi-branch access)" multi
                value={edit.extra_branches} onChange={v => setEdit(e => ({ ...e, extra_branches: v }))}
                options={branches.filter(b => b.id !== Number(edit.branch_id)).map(b => ({ value: b.id, label: b.name }))} />
            )}
            {!!edit.id && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontWeight: '700', flex: 1 }}>Active</Text>
                <Switch value={!!edit.active} onValueChange={v => setEdit(e => ({ ...e, active: v ? 1 : 0 }))} />
              </View>
            )}
            <Btn title={busy ? 'Saving…' : '💾 Save User'} color={colors.green} onPress={save} disabled={busy} />
            {!!edit.id && edit.id !== me.id && <Btn title="🗑 Delete User" color={colors.red} onPress={del} />}
            <Btn title="Cancel" color={colors.ink3} onPress={() => setEdit(null)} />
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}
