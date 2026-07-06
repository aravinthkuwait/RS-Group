import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Modal, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { api, fmt } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const today = () => new Date().toISOString().slice(0, 10);
const isLive = p => !!p.active && p.from_date <= today() && p.to_date >= today();
const blank = () => ({
  name: '', description: '', branch_id: '', discount_type: 'percent', discount_value: '',
  applies_to: 'all', category: '', medicine_id: '', medicine_name: '', min_bill_amount: '',
  from_date: today(), to_date: today(),
});

const appliesLabel = p => p.applies_to === 'all' ? 'Whole bill'
  : p.applies_to === 'category' ? `Category: ${p.category}` : `Item: ${p.medicine_name || ''}`;

function StatusBadge({ p }) {
  const [label, color] = isLive(p) ? ['LIVE', colors.green]
    : p.active ? [p.from_date > today() ? 'Scheduled' : 'Ended', colors.orange]
    : ['Inactive', colors.red];
  return (
    <View style={{ backgroundColor: color, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8, alignSelf: 'flex-start' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 10 }}>{label}</Text>
    </View>
  );
}

export default function OffersScreen() {
  const { user } = useAuth();
  const manage = can(user, 'discounts.manage');
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);
  const [categories, setCategories] = useState([]);

  const load = () => api('/promotions').then(d => setRows(d.promotions)).catch(e => Alert.alert('Error', e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api('/admin/settings').then(d => setCategories(d.settings.medicine_categories || [])).catch(() => {});
  }, []);

  const exportCsv = () => shareCsv('discount-offers', [
    { key: 'name', label: 'Offer' }, { key: 'branch', label: 'Branch' },
    { key: 'type', label: 'Type' }, { key: 'value', label: 'Value' },
    { key: 'applies', label: 'Applies To' }, { key: 'min_bill', label: 'Min Bill' },
    { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'status', label: 'Status' },
  ], rows.map(p => ({
    name: p.name, branch: p.branch_name || 'All branches', type: p.discount_type,
    value: p.discount_value,
    applies: p.applies_to === 'all' ? 'Whole bill' : p.applies_to === 'category' ? p.category : p.medicine_name,
    min_bill: p.min_bill_amount, from: p.from_date, to: p.to_date,
    status: isLive(p) ? 'live' : p.active ? 'scheduled/over' : 'inactive',
  })));

  const del = p => Alert.alert('Delete offer?', `Delete offer "${p.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const d = await api(`/promotions/${p.id}`, { method: 'DELETE' });
        if (d.message) Alert.alert('Offer deactivated', d.message);
        load();
      } catch (e) { Alert.alert('Error', e.message); }
    } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {manage && <View style={{ flex: 1 }}><Btn title="＋ New Offer" color={colors.green} onPress={() => setModal(blank())} /></View>}
        <View style={{ flex: 1 }}><Btn title="⬇ CSV" color={colors.ink2} onPress={exportCsv} /></View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={p => String(p.id)}
        ListEmptyComponent={<Text style={{ color: colors.ink3, textAlign: 'center', marginTop: 24 }}>No offers yet — create one to give promotional discounts at billing.</Text>}
        renderItem={({ item: p }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', flex: 1, marginRight: 8 }}>{p.name}</Text>
              <StatusBadge p={p} />
            </View>
            {!!p.description && <Text style={{ color: colors.ink3, fontSize: 12 }}>{p.description}</Text>}
            <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 4 }}>
              {p.discount_type === 'percent' ? `${p.discount_value}% off` : `${fmt(p.discount_value)} off`} · {appliesLabel(p)}
            </Text>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {p.branch_name || 'All branches'} · Min bill {p.min_bill_amount > 0 ? fmt(p.min_bill_amount) : '—'}
            </Text>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{p.from_date} → {p.to_date}</Text>
            {manage && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={() => setModal({
                  ...p, branch_id: p.branch_id ? String(p.branch_id) : '',
                  medicine_id: p.medicine_id ? String(p.medicine_id) : '',
                  discount_value: String(p.discount_value),
                  min_bill_amount: p.min_bill_amount ? String(p.min_bill_amount) : '',
                })}
                  style={{ backgroundColor: colors.brandLight, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 }}>
                  <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => del(p)}
                  style={{ backgroundColor: '#fdecea', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 }}>
                  <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12 }}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      />
      <Modal visible={!!modal} animationType="slide" onRequestClose={() => setModal(null)}>
        {modal && (
          <OfferModal offer={modal} categories={categories}
            onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
        )}
      </Modal>
    </View>
  );
}

function OfferModal({ offer, categories, onClose, onSaved }) {
  const { options: branches } = useBranch();
  const [f, setF] = useState(offer);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  // Medicine live-search (only when the offer applies to one medicine)
  const [mq, setMq] = useState('');
  const [meds, setMeds] = useState([]);
  const debounce = useRef(null);
  useEffect(() => {
    clearTimeout(debounce.current);
    if (f.applies_to !== 'medicine' || !mq.trim()) { setMeds([]); return; }
    debounce.current = setTimeout(() => {
      api('/inventory/medicines', { params: { q: mq.trim(), limit: 15 } })
        .then(d => setMeds(d.medicines)).catch(() => {});
    }, 250);
  }, [mq, f.applies_to]);

  const save = async () => {
    if (!f.name || !f.discount_value) return Alert.alert('Missing details', 'Offer name and discount value are required.');
    setBusy(true);
    try {
      const body = {
        name: f.name, description: f.description, branch_id: f.branch_id ? Number(f.branch_id) : null,
        discount_type: f.discount_type, discount_value: Number(f.discount_value),
        applies_to: f.applies_to, category: f.category,
        medicine_id: f.medicine_id ? Number(f.medicine_id) : null,
        min_bill_amount: Number(f.min_bill_amount) || 0,
        from_date: f.from_date, to_date: f.to_date,
        ...(f.id ? { active: f.active } : {}),
      };
      if (f.id) await api(`/promotions/${f.id}`, { method: 'PUT', body });
      else await api('/promotions', { method: 'POST', body });
      onSaved();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>
        {f.id ? `Edit offer — ${offer.name}` : 'New promotional offer'}
      </Text>
      <Field label="Offer name *" value={f.name} onChangeText={v => set('name', v)} />
      <Field label="Description" value={f.description} onChangeText={v => set('description', v)} />
      <Chips label="Branch" value={f.branch_id} onChange={v => set('branch_id', v)}
        options={[{ value: '', label: 'All branches' }, ...branches.map(b => ({ value: String(b.id), label: b.name }))]} />
      <Chips label="Discount type" value={f.discount_type} onChange={v => set('discount_type', v)}
        options={[{ value: 'percent', label: 'Percentage (%)' }, { value: 'amount', label: 'Fixed amount (₹)' }]} />
      <Field label={f.discount_type === 'percent' ? 'Discount % *' : 'Discount ₹ *'} keyboardType="numeric"
        value={String(f.discount_value)} onChangeText={v => set('discount_value', v)} />
      <Field label="Minimum bill amount ₹" keyboardType="numeric"
        value={String(f.min_bill_amount)} onChangeText={v => set('min_bill_amount', v)} />
      <Chips label="Applies to" value={f.applies_to} onChange={v => set('applies_to', v)}
        options={[{ value: 'all', label: 'Whole bill' }, { value: 'category', label: 'A category' }, { value: 'medicine', label: 'A medicine' }]} />
      {f.applies_to === 'category' && (
        <Chips label="Category" value={f.category} onChange={v => set('category', v)}
          options={categories.map(c => ({ value: c, label: c }))} />
      )}
      {f.applies_to === 'medicine' && (
        <View style={{ marginBottom: 10 }}>
          {!!f.medicine_id && (
            <Text style={{ color: colors.green, fontWeight: '700', fontSize: 13, marginBottom: 4 }}>
              ✓ {f.medicine_name || `Medicine #${f.medicine_id}`}
            </Text>
          )}
          <Field label="Medicine (search by name)" placeholder="Type to search…" value={mq} onChangeText={setMq} />
          {meds.map(m => (
            <TouchableOpacity key={m.id}
              onPress={() => { setF(x => ({ ...x, medicine_id: String(m.id), medicine_name: m.name })); setMq(''); setMeds([]); }}
              style={{ backgroundColor: '#fff', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.line, marginBottom: 4 }}>
              <Text style={{ fontWeight: '600', fontSize: 13 }}>{m.name}</Text>
              {!!m.category && <Text style={{ color: colors.ink3, fontSize: 11 }}>{m.category}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
      <Field label="Valid from * (YYYY-MM-DD)" placeholder="YYYY-MM-DD" value={f.from_date} onChangeText={v => set('from_date', v)} />
      <Field label="Valid to * (YYYY-MM-DD)" placeholder="YYYY-MM-DD" value={f.to_date} onChangeText={v => set('to_date', v)} />
      {f.id != null && (
        <Chips label="Status" value={f.active ? 1 : 0} onChange={v => set('active', v)}
          options={[{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }]} />
      )}
      <Btn title={busy ? 'Saving…' : '💾 Save Offer'} color={colors.green} onPress={save} disabled={busy} />
      <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
    </ScrollView>
  );
}
