import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Modal, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { api } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const STATUS_COLOR = { pending: colors.orange, completed: colors.green, cancelled: colors.ink3 };

const CSV_COLS = [
  { key: 'id', label: '#' }, { key: 'created_at', label: 'Date' },
  { key: 'from_branch', label: 'From' }, { key: 'to_branch', label: 'To' },
  { key: 'notes', label: 'Notes' }, { key: 'status', label: 'Status' },
];

export default function TransfersScreen() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [showNew, setShowNew] = useState(false);

  const load = () => api('/inventory/transfers', { params: { branch_id: branchId } })
    .then(d => setRows(d.transfers)).catch(e => Alert.alert('Error', e.message));
  useEffect(() => { load(); }, [branchId]);
  // Full branch list for pickers — every logged-in user may list branches (same as web).
  useEffect(() => { api('/admin/branches').then(d => setBranches(d.branches)).catch(() => {}); }, []);

  const receive = async t => {
    try {
      await api(`/inventory/transfers/${t.id}/receive`, { method: 'POST', body: {} });
      Alert.alert('Received', `Transfer #${t.id} received into ${t.to_branch}`); load();
    } catch (e) { Alert.alert('Could not receive', e.message); }
  };
  const cancel = t => {
    Alert.alert('Cancel transfer?', 'Cancel this transfer and restore stock to the source branch?', [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, cancel', style: 'destructive', onPress: async () => {
        try {
          await api(`/inventory/transfers/${t.id}/cancel`, { method: 'POST', body: {} });
          load();
        } catch (e) { Alert.alert('Could not cancel', e.message); }
      } },
    ]);
  };

  // Same gating as web Transfers.jsx:31-32
  const canReceive = t => t.status === 'pending' && (user.role === 'super_admin' || user.branch_id === t.to_branch_id);
  const canCancel = t => t.status === 'pending' && (user.role === 'super_admin' || user.branch_id === t.from_branch_id);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {can(user, 'inventory.transfer') && (
          <View style={{ flex: 1 }}><Btn title="＋ New Transfer" onPress={() => setShowNew(true)} /></View>
        )}
        <View style={{ flex: 1 }}>
          <Btn title="⇪ Export CSV" color={colors.ink2} onPress={() => shareCsv('stock-transfers', CSV_COLS, rows)} />
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ color: colors.ink3, textAlign: 'center', marginTop: 30 }}>No transfers yet</Text>}
        renderItem={({ item: t }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', flex: 1 }}>#{t.id} · {t.from_branch} → {t.to_branch}</Text>
              <View style={{ backgroundColor: STATUS_COLOR[t.status] || colors.brand, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{t.status}</Text>
              </View>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12, marginBottom: 4 }}>{t.created_at}</Text>
            {t.items.map(i => (
              <Text key={i.id} style={{ color: colors.ink2, fontSize: 12 }}>
                {i.medicine_name} · {i.batch_no} × <Text style={{ fontWeight: '800' }}>{i.qty}</Text>
              </Text>
            ))}
            {!!t.notes && <Text style={{ color: colors.ink3, fontSize: 12, fontStyle: 'italic', marginTop: 2 }}>{t.notes}</Text>}
            {(canReceive(t) || canCancel(t)) && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {canReceive(t) && (
                  <TouchableOpacity onPress={() => receive(t)} style={{ backgroundColor: colors.green, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Receive</Text>
                  </TouchableOpacity>
                )}
                {canCancel(t) && (
                  <TouchableOpacity onPress={() => cancel(t)} style={{ backgroundColor: colors.red, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
      />
      <Modal visible={showNew} animationType="slide" onRequestClose={() => setShowNew(false)}>
        {showNew && (
          <NewTransfer branches={branches} onClose={() => setShowNew(false)}
            onSaved={() => { setShowNew(false); load(); }} />
        )}
      </Modal>
    </View>
  );
}

function NewTransfer({ branches, onClose, onSaved }) {
  const { user } = useAuth();
  const { branchId } = useBranch();
  // Mirrors web: super admin transfers from the currently selected branch, staff from their own.
  const fromBranch = user.role === 'super_admin' ? (branchId || branches[0]?.id) : user.branch_id;
  const [toBranch, setToBranch] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (q.length < 2) { setFound([]); return; }
    debounce.current = setTimeout(() => {
      api('/inventory/stock', { params: { q, branch_id: fromBranch } }).then(d => setFound(d.stock)).catch(() => {});
    }, 200);
  }, [q, fromBranch]);

  const addBatch = b => {
    if (!items.some(i => i.batch_id === b.id)) {
      setItems(it => [...it, { batch_id: b.id, name: b.medicine_name, batch_no: b.batch_no, max: b.qty, qty: '' }]);
    }
    setQ(''); setFound([]);
  };
  const setQty = (batch_id, v, max) => {
    const clean = v.replace(/[^0-9]/g, '');
    const qty = clean === '' ? '' : String(Math.min(Number(clean), max));
    setItems(its => its.map(i => (i.batch_id === batch_id ? { ...i, qty } : i)));
  };

  const save = async () => {
    setBusy(true);
    try {
      await api('/inventory/transfers', {
        method: 'POST',
        body: {
          from_branch_id: Number(fromBranch), to_branch_id: Number(toBranch), notes,
          items: items.map(i => ({ batch_id: i.batch_id, qty: Number(i.qty) })),
        },
      });
      Alert.alert('Transfer created', 'Destination branch can now receive it');
      onSaved();
    } catch (e) { Alert.alert('Could not create transfer', e.message); }
    setBusy(false);
  };

  const fromName = branches.find(b => b.id === Number(fromBranch))?.name || '—';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}
      keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>New stock transfer</Text>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink2, marginBottom: 4 }}>From branch</Text>
      <Text style={{ backgroundColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 10, color: colors.ink2, fontWeight: '600' }}>
        🏬 {fromName}
      </Text>
      <Chips label="To branch *" value={toBranch} onChange={setToBranch}
        options={branches.filter(b => b.id !== Number(fromBranch)).map(b => ({ value: b.id, label: b.name }))} />
      <Field label="Find batch in source branch" placeholder="🔍 Medicine, batch, brand…" value={q} onChangeText={setQ} />
      {found.length > 0 && (
        <View style={[{ backgroundColor: '#fff', borderRadius: 10, marginBottom: 10, maxHeight: 260 }, shadow]}>
          {found.slice(0, 15).map(b => (
            <TouchableOpacity key={String(b.id)} onPress={() => addBatch(b)}
              style={{ padding: 10, borderBottomWidth: 1, borderColor: colors.line }}>
              <Text style={{ fontWeight: '700' }}>{b.medicine_name} · {b.batch_no}</Text>
              <Text style={{ color: colors.ink3, fontSize: 12 }}>{b.qty} available · exp {b.expiry_date}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {items.length === 0
        ? <Text style={{ color: colors.ink3, textAlign: 'center', marginVertical: 14 }}>Search above to add batches</Text>
        : items.map(i => (
          <View key={String(i.batch_id)} style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }, shadow]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }} numberOfLines={1}>{i.name}</Text>
              <Text style={{ color: colors.ink3, fontSize: 12 }}>Batch {i.batch_no} · {i.max} available</Text>
            </View>
            <TextInput
              style={{ width: 70, textAlign: 'right', backgroundColor: colors.surface, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: colors.line, marginRight: 8 }}
              keyboardType="numeric" placeholder="Qty" placeholderTextColor={colors.ink3}
              value={String(i.qty)} onChangeText={v => setQty(i.batch_id, v, i.max)} />
            <TouchableOpacity onPress={() => setItems(its => its.filter(x => x.batch_id !== i.batch_id))}>
              <Text style={{ color: colors.red, fontWeight: '800', fontSize: 16, padding: 4 }}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="optional" />
      <Btn title={busy ? 'Creating…' : '🚚 Create Transfer'} color={colors.green} onPress={save}
        disabled={busy || !toBranch || !items.length || items.some(i => !i.qty)} />
      <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
    </ScrollView>
  );
}
