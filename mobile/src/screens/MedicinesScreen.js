import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const LIMIT = 25;
const CSV_COLUMNS = [
  { key: 'name', label: 'Name' }, { key: 'generic_name', label: 'Generic' },
  { key: 'category', label: 'Category' }, { key: 'brand', label: 'Brand' },
  { key: 'barcode', label: 'Barcode' }, { key: 'gst_rate', label: 'GST %' },
  { key: 'rack_location', label: 'Rack' }, { key: 'min_stock', label: 'Min stock' },
  { key: 'stock', label: 'In stock' },
];

function Badge({ color, children }) {
  const bg = { green: colors.greenLight, orange: colors.orangeLight, red: '#fdeceb' }[color] || colors.brandLight;
  const fg = { green: colors.green, orange: colors.orange, red: colors.red }[color] || colors.brand;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8 }}>
      <Text style={{ color: fg, fontWeight: '800', fontSize: 12 }}>{children}</Text>
    </View>
  );
}

export default function MedicinesScreen() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [cats, setCats] = useState([]);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const debounce = useRef(null);

  const load = () => api('/inventory/medicines', { params: { q, category, branch_id: branchId, page, limit: LIMIT } })
    .then(d => { setRows(d.medicines); setTotal(d.total); }).catch(e => Alert.alert('Error', e.message));
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
  }, [q, category, branchId, page]);
  useEffect(() => { api('/admin/settings').then(d => setCats(d.settings.medicine_categories || [])).catch(() => {}); }, []);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const canEdit = can(user, 'inventory.edit');

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      {canEdit && <Btn title="＋ Add Medicine" onPress={() => setEdit({})} />}
      <TextInput
        style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 8 }}
        placeholder="Search name / generic / brand / barcode…" value={q} onChangeText={v => { setQ(v); setPage(1); }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {['', ...cats].map(c => (
            <TouchableOpacity key={c || 'all'} onPress={() => { setCategory(c); setPage(1); }}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: category === c ? colors.brand : colors.brandLight }}>
              <Text style={{ color: category === c ? '#fff' : colors.brand, fontWeight: '700', fontSize: 12 }}>{c || 'All'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flex: 1, color: colors.ink3, fontSize: 12 }}>{total} medicines</Text>
        <TouchableOpacity onPress={() => shareCsv('medicines.csv', CSV_COLUMNS, rows || [])}
          style={{ backgroundColor: colors.brandLight, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>⬇ CSV</Text>
        </TouchableOpacity>
      </View>
      {!rows ? <ActivityIndicator color={colors.brand} style={{ marginTop: 30 }} /> : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={({ item }) => (
            <TouchableOpacity disabled={!canEdit} onPress={() => setEdit(item)}
              style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{item.name}</Text>
                {!!item.prescription_required && <Badge color="orange">Rx</Badge>}
                <Badge color={item.stock <= 0 ? 'red' : item.stock <= item.min_stock ? 'orange' : 'green'}>
                  {item.stock} {item.unit}
                </Badge>
              </View>
              {!!item.generic_name && <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 2 }}>{item.generic_name}</Text>}
              <Text style={{ color: colors.ink2, fontSize: 12, marginTop: 2 }}>
                {item.category}{item.brand ? ` · ${item.brand}` : ''} · GST {item.gst_rate}% · Strip {item.strip_count || 1}
                {item.rack_location ? ` · Rack ${item.rack_location}` : ''} · Min {item.min_stock}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, gap: 10 }}>
        <TouchableOpacity disabled={page <= 1} onPress={() => setPage(p => p - 1)}
          style={{ backgroundColor: page <= 1 ? colors.line : colors.brandLight, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
          <Text style={{ color: page <= 1 ? colors.ink3 : colors.brand, fontWeight: '700' }}>← Prev</Text>
        </TouchableOpacity>
        <Text style={{ flex: 1, textAlign: 'center', color: colors.ink3, fontSize: 12 }}>Page {page} of {pages}</Text>
        <TouchableOpacity disabled={page >= pages} onPress={() => setPage(p => p + 1)}
          style={{ backgroundColor: page >= pages ? colors.line : colors.brandLight, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
          <Text style={{ color: page >= pages ? colors.ink3 : colors.brand, fontWeight: '700' }}>Next →</Text>
        </TouchableOpacity>
      </View>
      <Modal visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        {edit && <MedicineForm med={edit} cats={cats} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      </Modal>
    </View>
  );
}

function MedicineForm({ med, cats, onClose, onSaved }) {
  const [f, setF] = useState({
    name: med.name || '', generic_name: med.generic_name || '', category: med.category || 'Tablet',
    brand: med.brand || '', barcode: med.barcode || '', hsn: med.hsn || '3004', gst_rate: String(med.gst_rate ?? 12),
    unit: med.unit || 'Strip', rack_location: med.rack_location || '', min_stock: String(med.min_stock ?? 10),
    strip_count: String(med.strip_count ?? 1), prescription_required: !!med.prescription_required,
  });
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(s => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return Alert.alert('Missing details', 'Medicine name is required.');
    setBusy(true);
    try {
      const body = {
        ...f, name: f.name.trim(), gst_rate: Number(f.gst_rate) || 0, min_stock: Number(f.min_stock) || 0,
        strip_count: Math.max(1, Number(f.strip_count) || 1), prescription_required: f.prescription_required ? 1 : 0,
      };
      if (med.id) await api(`/inventory/medicines/${med.id}`, { method: 'PUT', body });
      else await api('/inventory/medicines', { method: 'POST', body });
      onSaved();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{med.id ? `Edit ${med.name}` : 'Add medicine'}</Text>
      <Field label="Name *" value={f.name} onChangeText={set('name')} />
      <Field label="Generic name" value={f.generic_name} onChangeText={set('generic_name')} />
      <Chips label="Category" value={f.category} onChange={set('category')}
        options={(cats.length ? cats : [f.category]).map(c => ({ value: c, label: c }))} />
      <Field label="Brand / company" value={f.brand} onChangeText={set('brand')} />
      <Field label="Barcode" value={f.barcode} onChangeText={set('barcode')} />
      <Field label="HSN" value={f.hsn} onChangeText={set('hsn')} />
      <Field label="GST %" keyboardType="numeric" value={f.gst_rate} onChangeText={set('gst_rate')} />
      <Field label="Unit" value={f.unit} onChangeText={set('unit')} />
      <Field label="Strip count (tabs/caps per strip)" keyboardType="numeric" value={f.strip_count} onChangeText={set('strip_count')} />
      <Field label="Rack location" value={f.rack_location} onChangeText={set('rack_location')} />
      <Field label="Min stock alert" keyboardType="numeric" value={f.min_stock} onChangeText={set('min_stock')} />
      <Chips label="Prescription required (Schedule H)" value={f.prescription_required} onChange={set('prescription_required')}
        options={[{ value: false, label: 'No' }, { value: true, label: 'Rx required' }]} />
      <Btn title={busy ? 'Saving…' : '💾 Save Medicine'} color={colors.green} onPress={save} disabled={busy} />
      <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
    </ScrollView>
  );
}
