import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native';
import { api, fmt } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const STOCK_CSV = [
  { key: 'medicine_name', label: 'Medicine' }, { key: 'branch_code', label: 'Branch' },
  { key: 'batch_no', label: 'Batch' }, { key: 'expiry_date', label: 'Expiry' },
  { key: 'qty', label: 'Qty' }, { key: 'damaged_qty', label: 'Damaged' },
  { key: 'mrp', label: 'MRP' }, { key: 'selling_price', label: 'Selling' },
  { key: 'purchase_price', label: 'Cost' },
];
const ADJ_CSV = [
  { key: 'created_at', label: 'Date' }, { key: 'medicine_name', label: 'Medicine' },
  { key: 'batch_no', label: 'Batch' }, { key: 'branch_name', label: 'Branch' },
  { key: 'qty_change', label: 'Change' }, { key: 'type', label: 'Type' },
  { key: 'reason', label: 'Reason' }, { key: 'user_name', label: 'By' },
];

function SmallBtn({ title, onPress }) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{ backgroundColor: colors.brandLight, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}>
      <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>{title}</Text>
    </TouchableOpacity>
  );
}

export default function StockScreen() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [adjust, setAdjust] = useState(null); // batch being adjusted
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const debounce = useRef(null);

  const load = () => api('/inventory/stock', { params: { q, branch_id: branchId } }).then(d => setRows(d.stock)).catch(() => {});
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
  }, [q, branchId]);

  const loadHistory = () => api('/inventory/adjustments', { params: { branch_id: branchId } })
    .then(d => setHistory(d.adjustments)).catch(e => Alert.alert('Error', e.message));
  useEffect(() => { if (showHistory) { loadHistory(); } }, [showHistory, branchId]);

  const value = rows.reduce((a, r) => a + r.qty * r.purchase_price, 0);
  const canAdjust = can(user, 'inventory.adjust');

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      <TextInput
        style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 8 }}
        placeholder="Search stock by medicine or batch…" value={q} onChangeText={setQ} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text style={{ flex: 1, color: colors.ink3, fontSize: 12 }}>
          {showHistory ? `${history.length} adjustments` : `${rows.length} batches · value ${fmt(value)}`}
        </Text>
        <SmallBtn title="⬇ CSV" onPress={() => showHistory
          ? shareCsv('stock-adjustments.csv', ADJ_CSV, history)
          : shareCsv('stock-batches.csv', STOCK_CSV, rows)} />
        <SmallBtn title={showHistory ? '📦 Stock' : '🛠 History'} onPress={() => setShowHistory(h => !h)} />
      </View>

      {showHistory ? (
        <FlatList
          data={history}
          keyExtractor={r => String(r.id)}
          renderItem={({ item }) => (
            <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{item.medicine_name}</Text>
                <Text style={{ fontWeight: '800', color: item.qty_change < 0 ? colors.red : colors.green }}>
                  {item.qty_change > 0 ? '+' : ''}{item.qty_change}
                </Text>
              </View>
              <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 2 }}>
                {item.created_at} · Batch {item.batch_no} · {item.branch_name} · {item.type}
              </Text>
              <Text style={{ color: colors.ink2, fontSize: 12 }}>{item.reason}{item.user_name ? ` — ${item.user_name}` : ''}</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={({ item }) => (
            <TouchableOpacity disabled={!canAdjust} onLongPress={() => setAdjust(item)}
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
              <Text style={{ color: colors.ink2, fontSize: 12 }}>
                MRP {fmt(item.mrp)} · Selling {fmt(item.selling_price)} · Cost {fmt(item.purchase_price)} · Rack {item.rack_location}
              </Text>
              {item.damaged_qty > 0 && (
                <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12, marginTop: 2 }}>Damaged: {item.damaged_qty}</Text>
              )}
              {canAdjust && (
                <TouchableOpacity onPress={() => setAdjust(item)} style={{ alignSelf: 'flex-start', marginTop: 6, backgroundColor: colors.brandLight, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 }}>
                  <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>🛠 Adjust</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={!!adjust} animationType="slide" onRequestClose={() => setAdjust(null)}>
        {adjust && <AdjustForm batch={adjust} onClose={() => setAdjust(null)}
          onSaved={() => { setAdjust(null); load(); if (showHistory) loadHistory(); }} />}
      </Modal>
    </View>
  );
}

function AdjustForm({ batch, onClose, onSaved }) {
  const [change, setChange] = useState('');
  const [type, setType] = useState('adjustment');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const step = d => setChange(c => String((Number(c) || 0) + d));

  const save = async () => {
    const n = Number(change);
    if (!n) return Alert.alert('Missing details', 'Enter a non-zero quantity change.');
    if (!reason.trim()) return Alert.alert('Missing details', 'A reason is required.');
    setBusy(true);
    try {
      // Server applies the adjustment against the batch's own branch_id.
      await api('/inventory/adjustments', {
        method: 'POST',
        body: { batch_id: batch.id, qty_change: type === 'adjustment' ? n : -Math.abs(n), type, reason: reason.trim() },
      });
      onSaved();
    } catch (e) { Alert.alert('Could not adjust', e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
      <Text style={{ fontSize: 18, fontWeight: '800' }}>Stock adjustment</Text>
      <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 4, marginBottom: 12 }}>
        {batch.medicine_name} · Batch {batch.batch_no} · {batch.branch_code} · current qty {batch.qty} · exp {batch.expiry_date}
      </Text>
      <Chips label="Type" value={type} onChange={setType} options={[
        { value: 'adjustment', label: 'Correction (+/-)' },
        { value: 'damage', label: 'Damaged (-)' },
        { value: 'expiry_writeoff', label: 'Expiry write-off (-)' },
      ]} />
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink2, marginBottom: 4 }}>
        {type === 'adjustment' ? 'Quantity change (e.g. -2 or 5)' : 'Quantity to remove'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <TouchableOpacity onPress={() => step(-1)} style={{ backgroundColor: colors.brandLight, borderRadius: 8, width: 44, paddingVertical: 10 }}>
          <Text style={{ color: colors.brand, fontWeight: '800', textAlign: 'center', fontSize: 16 }}>−</Text>
        </TouchableOpacity>
        <TextInput
          style={{ flex: 1, backgroundColor: '#fff', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.line, textAlign: 'center', fontWeight: '800' }}
          keyboardType="numbers-and-punctuation" value={change} onChangeText={setChange} placeholder="0" placeholderTextColor={colors.ink3} />
        <TouchableOpacity onPress={() => step(1)} style={{ backgroundColor: colors.brandLight, borderRadius: 8, width: 44, paddingVertical: 10 }}>
          <Text style={{ color: colors.brand, fontWeight: '800', textAlign: 'center', fontSize: 16 }}>＋</Text>
        </TouchableOpacity>
      </View>
      <Field label="Reason *" value={reason} onChangeText={setReason} placeholder="e.g. physical count mismatch, broken strip" />
      <Btn title={busy ? 'Saving…' : '💾 Save Adjustment'} color={colors.green} onPress={save} disabled={busy || !Number(change) || !reason.trim()} />
      <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
    </ScrollView>
  );
}
