import React, { useState } from 'react';
import { ScrollView, Text, Alert } from 'react-native';
import { api } from '../api';
import { useAuth, useBranch } from '../../App';
import { Field, Chips, Btn } from '../ui';
import { colors } from '../theme';

const ROLES = ['branch_admin', 'branch_manager', 'pharmacist', 'billing_staff', 'inventory_staff', 'accountant', 'delivery_staff'];

// Broadcast an announcement to staff — parity with web Staff → Announcements.
export default function AnnounceScreen() {
  const { user } = useAuth();
  const { options } = useBranch();
  const [f, setF] = useState({ title: '', message: '', branch_id: '', role: '' });
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(x => ({ ...x, [k]: v }));

  const send = async () => {
    setBusy(true);
    try {
      await api('/staff/notifications/broadcast', {
        method: 'POST',
        body: { ...f, branch_id: f.branch_id ? Number(f.branch_id) : null, role: f.role || null },
      });
      setF({ title: '', message: '', branch_id: '', role: '' });
      Alert.alert('Sent', 'Announcement sent to staff in real time ✓');
    } catch (e) { Alert.alert('Error', e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 14 }}>
      <Text style={{ color: colors.ink2, marginBottom: 10 }}>
        Appears instantly in the web & mobile app of the selected staff.
      </Text>
      <Field label="Title *" value={f.title} onChangeText={set('title')} placeholder="e.g. Stock audit tomorrow 9 AM" />
      <Field label="Message" value={f.message} onChangeText={set('message')} multiline />
      {user.role === 'super_admin' && (
        <Chips label="Branch" value={f.branch_id} onChange={set('branch_id')}
          options={[{ value: '', label: 'All branches' }, ...options.map(b => ({ value: String(b.id), label: b.code || b.name }))]} />
      )}
      <Chips label="Only role (optional)" value={f.role} onChange={set('role')}
        options={[{ value: '', label: 'All roles' }, ...ROLES.map(r => ({ value: r, label: r.replace(/_/g, ' ') }))]} />
      <Btn title={busy ? 'Sending…' : '📢 Send announcement'} onPress={send} disabled={busy || !f.title} />
    </ScrollView>
  );
}
