import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, Modal, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const blankTask = { title: '', description: '', assigned_to: null, due_date: '', branch_id: null };

export default function TasksScreen() {
  const { user } = useAuth();
  const { branchId, options: branchOptions } = useBranch();
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null); // null = closed, object = create modal open
  const [busy, setBusy] = useState(false);
  const canManage = can(user, 'tasks.manage');

  const load = useCallback(() => {
    api('/staff/tasks', { params: { branch_id: branchId } }).then(d => setRows(d.tasks)).catch(() => {});
    if (canManage) api('/admin/users').then(d => setUsers(d.users.filter(x => x.active))).catch(() => {});
  }, [branchId, canManage]);
  useFocusEffect(load);

  const setStatus = async (item, status) => {
    try {
      await api(`/staff/tasks/${item.id}`, { method: 'PUT', body: { status } });
      load();
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const create = async () => {
    if (!form.title) return Alert.alert('Missing details', 'Task title is required.');
    setBusy(true);
    try {
      await api('/staff/tasks', { method: 'POST', body: {
        title: form.title, description: form.description,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
        due_date: form.due_date || null,
        branch_id: form.branch_id ? Number(form.branch_id) : null,
      } });
      Alert.alert('Created', 'Task created');
      setForm(null); load();
    } catch (e) { Alert.alert('Could not create', e.message); }
    setBusy(false);
  };

  const exportCsv = () => shareCsv('tasks', [
    { key: 'title', label: 'Task' }, { key: 'assigned_to_name', label: 'Assigned to' },
    { key: 'branch_name', label: 'Branch' }, { key: 'due_date', label: 'Due' },
    { key: 'status', label: 'Status' },
  ], rows);

  const statusColor = { pending: colors.orange, in_progress: colors.brand, done: colors.green, cancelled: colors.red };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {canManage && (
          <View style={{ flex: 1 }}>
            <Btn title="＋ New Task" onPress={() => setForm({ ...blankTask })} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Btn title="⬇ Export CSV" color={colors.ink2} onPress={exportCsv} />
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No tasks assigned 🎉</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: statusColor[item.status] || colors.line }, shadow]}>
            <Text style={{ fontWeight: '700' }}>{item.title}</Text>
            {!!item.description && <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>{item.description}</Text>}
            <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 4 }}>
              {item.due_date ? `Due ${item.due_date} · ` : ''}{String(item.status).replace(/_/g, ' ')} · by {item.created_by_name}
              {item.assigned_to_name ? ` · → ${item.assigned_to_name}` : ''}
            </Text>
            {item.status !== 'done' && item.status !== 'cancelled' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {item.status === 'pending' && (
                  <TouchableOpacity onPress={() => setStatus(item, 'in_progress')}
                    style={{ backgroundColor: colors.brand, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Start</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setStatus(item, 'done')}
                  style={{ backgroundColor: colors.green, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Mark done ✓</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />

      <Modal visible={!!form} animationType="slide" onRequestClose={() => setForm(null)}>
        {form && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>New Task</Text>
            <Field label="Title *" value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} />
            <Field label="Description" value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))} />
            <Chips label="Assign to" value={form.assigned_to} onChange={v => setForm(f => ({ ...f, assigned_to: v }))}
              options={[
                { value: null, label: '— unassigned —' },
                ...users.map(u => ({ value: u.id, label: `${u.name} (${u.role.replace(/_/g, ' ')})` })),
              ]} />
            <Field label="Due date (YYYY-MM-DD)" placeholder="e.g. 2026-07-15" autoCapitalize="none"
              value={form.due_date} onChangeText={v => setForm(f => ({ ...f, due_date: v }))} />
            {user.role === 'super_admin' && (
              <Chips label="Branch" value={form.branch_id} onChange={v => setForm(f => ({ ...f, branch_id: v }))}
                options={[
                  { value: null, label: 'All branches' },
                  ...branchOptions.map(b => ({ value: b.id, label: b.name })),
                ]} />
            )}
            <Btn title={busy ? 'Creating…' : '📋 Create Task'} color={colors.green} onPress={create} disabled={busy || !form.title} />
            <Btn title="Cancel" color={colors.ink3} onPress={() => setForm(null)} />
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}
