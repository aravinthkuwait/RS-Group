import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, Alert, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, fmt } from '../api';
import { colors, shadow } from '../theme';
import { Field, Chips, Btn } from '../ui';

const DRAFT_KEY = 'rsg_purchase_draft';
const todayStr = () => new Date().toISOString().slice(0, 10);
const blankItem = () => ({
  medicine_id: null, name: '', brand: '', generic_name: '', strip_count: '', gst_rate: 12,
  batch_no: '', expiry_date: '', qty: '', free_qty: '', purchase_price: '', mrp: '', selling_price: '', isNew: false,
});

// Searchable picker with "add new" — used for Brand and Generic name.
function PickerField({ label, value, onChange, endpoint, listKey }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  useEffect(() => {
    if (!open) return;
    api(endpoint, { params: { q } }).then(d => setOpts(d[listKey] || [])).catch(() => setOpts([]));
  }, [open, q]);
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink2, marginBottom: 4 }}>{label}</Text>
      <TouchableOpacity onPress={() => { setQ(''); setOpen(true); }}
        style={{ backgroundColor: '#fff', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.line }}>
        <Text style={{ color: value ? colors.ink : colors.ink3 }}>{value || `Select or add ${label.toLowerCase()}…`}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'center', padding: 20 }}>
          <View style={[{ backgroundColor: '#fff', borderRadius: 14, padding: 12, maxHeight: '75%' }, shadow]}>
            <TextInput autoFocus placeholder={`Search or type new ${label.toLowerCase()}`} value={q} onChangeText={setQ}
              style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 8 }} />
            <ScrollView keyboardShouldPersistTaps="handled">
              {q.trim().length > 0 && !opts.some(o => o.name.toLowerCase() === q.trim().toLowerCase()) && (
                <TouchableOpacity onPress={() => { onChange(q.trim()); setOpen(false); }}
                  style={{ padding: 12, backgroundColor: colors.brandLight, borderRadius: 8, marginBottom: 4 }}>
                  <Text style={{ color: colors.brand, fontWeight: '700' }}>➕ Add "{q.trim()}"</Text>
                </TouchableOpacity>
              )}
              {opts.map(o => (
                <TouchableOpacity key={o.name} onPress={() => { onChange(o.name); setOpen(false); }}
                  style={{ padding: 12, borderBottomWidth: 1, borderColor: colors.line }}>
                  <Text style={{ fontWeight: '600' }}>{o.name}</Text>
                  {!!(o.brands || o.medicines) && <Text style={{ color: colors.ink3, fontSize: 12 }}>{o.brands || o.medicines}</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Btn title="Close" color={colors.ink3} onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function PurchaseEntryScreen({ route, navigation }) {
  const branchId = route.params?.branchId;
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [paidAmount, setPaidAmount] = useState('');
  const [paidMethod, setPaidMethod] = useState('bank');
  const [invoiceFile, setInvoiceFile] = useState(null); // base64 data URL of supplier invoice photo
  const [photoMode, setPhotoMode] = useState(false);    // camera modal captures photo instead of barcode
  const camRef = useRef(null);
  const [items, setItems] = useState([]);
  const [editIdx, setEditIdx] = useState(null); // index being edited, -1 = new
  const [draft, setDraft] = useState(blankItem());
  const [supplierPick, setSupplierPick] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const restored = useRef(false);

  useEffect(() => { api('/purchases/suppliers').then(d => setSuppliers(d.suppliers)).catch(() => {}); }, []);

  // Restore autosaved draft
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(DRAFT_KEY);
      if (raw) {
        try {
          const d = JSON.parse(raw);
          if (d.items?.length || d.invoiceNo) {
            setSupplierId(d.supplierId || ''); setInvoiceNo(d.invoiceNo || '');
            setInvoiceDate(d.invoiceDate || todayStr()); setPaidAmount(d.paidAmount || '');
            setPaidMethod(d.paidMethod || 'bank'); setInvoiceFile(d.invoiceFile || null);
            setItems(d.items || []);
          }
        } catch {}
      }
      restored.current = true;
    })();
  }, []);

  // Autosave draft whenever the entry changes
  useEffect(() => {
    if (!restored.current) return;
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ supplierId, invoiceNo, invoiceDate, paidAmount, paidMethod, invoiceFile, items })).catch(() => {});
  }, [supplierId, invoiceNo, invoiceDate, paidAmount, paidMethod, invoiceFile, items]);

  const total = items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.purchase_price) || 0), 0);
  const supplierName = suppliers.find(s => s.id === Number(supplierId))?.name;

  const openNew = () => { setDraft(blankItem()); setEditIdx(-1); };
  const openEdit = (i) => { setDraft({ ...items[i] }); setEditIdx(i); };

  const lookupMedicine = async (term) => {
    const d = await api('/inventory/medicines', { params: { q: term, limit: 1 } }).catch(() => ({ medicines: [] }));
    const m = d.medicines?.[0];
    if (m) setDraft(x => ({ ...x, medicine_id: m.id, name: m.name, brand: m.brand || '', generic_name: m.generic_name || '', strip_count: String(m.strip_count || ''), gst_rate: m.gst_rate, isNew: false }));
    else setDraft(x => ({ ...x, medicine_id: null, isNew: true }));
  };

  const onScan = ({ data }) => {
    if (!scanning || photoMode) return;
    setScanning(false);
    setDraft(x => ({ ...x, name: data }));
    lookupMedicine(data);
  };
  const startScan = async () => {
    if (!permission?.granted) { const r = await requestPermission(); if (!r.granted) return Alert.alert('Camera permission needed'); }
    setPhotoMode(false); setScanning(true);
  };
  const startInvoicePhoto = async () => {
    if (!permission?.granted) { const r = await requestPermission(); if (!r.granted) return Alert.alert('Camera permission needed'); }
    setPhotoMode(true); setScanning(true);
  };
  const snapInvoice = async () => {
    try {
      const photo = await camRef.current?.takePictureAsync({ base64: true, quality: 0.4 });
      if (photo?.base64) setInvoiceFile(`data:image/jpeg;base64,${photo.base64}`);
    } catch { Alert.alert('Could not capture photo'); }
    setScanning(false); setPhotoMode(false);
  };

  const saveItem = () => {
    const d = draft;
    if (!d.name.trim()) return Alert.alert('Enter the medicine name');
    if (!d.brand.trim() || !d.generic_name.trim()) return Alert.alert('Brand name and generic name are required');
    if (!Number(d.strip_count)) return Alert.alert('Strip count is required');
    if (!d.batch_no.trim()) return Alert.alert('Batch number is required');
    if (!/^\d{1,2}\/\d{4}$/.test(d.expiry_date.trim())) return Alert.alert('Expiry must be in MM/YYYY format');
    if (!Number(d.qty)) return Alert.alert('Quantity is required');
    setItems(list => editIdx === -1 ? [...list, d] : list.map((it, i) => i === editIdx ? d : it));
    setEditIdx(null);
  };

  const save = async () => {
    if (!supplierId) return Alert.alert('Choose a supplier');
    if (!invoiceNo.trim()) return Alert.alert('Enter the supplier invoice number');
    if (!items.length) return Alert.alert('Add at least one item');
    setBusy(true);
    try {
      await api('/purchases', {
        method: 'POST',
        body: {
          branch_id: branchId, supplier_id: Number(supplierId), invoice_no: invoiceNo.trim(),
          invoice_date: invoiceDate, paid_amount: Number(paidAmount) || 0,
          paid_method: paidMethod, invoice_file: invoiceFile || undefined,
          items: items.map(it => ({
            medicine_id: it.medicine_id || undefined, medicine_name: it.name.trim(),
            brand: it.brand.trim(), generic_name: it.generic_name.trim(), strip_count: Number(it.strip_count) || 1,
            gst_rate: it.gst_rate, batch_no: it.batch_no.trim(), expiry_date: it.expiry_date.trim(),
            qty: Number(it.qty), free_qty: Number(it.free_qty) || 0,
            purchase_price: Number(it.purchase_price), mrp: Number(it.mrp),
            selling_price: Number(it.selling_price) || Number(it.mrp),
          })),
        },
      });
      await AsyncStorage.removeItem(DRAFT_KEY);
      Alert.alert('Purchase saved ✓', 'Stock updated batch-wise', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  const discardDraft = async () => { await AsyncStorage.removeItem(DRAFT_KEY); navigation.goBack(); };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 14 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink2, marginBottom: 4 }}>Supplier *</Text>
      <TouchableOpacity onPress={() => setSupplierPick(true)}
        style={{ backgroundColor: '#fff', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 10 }}>
        <Text style={{ color: supplierName ? colors.ink : colors.ink3 }}>{supplierName || 'Choose supplier…'}</Text>
      </TouchableOpacity>
      <Field label="Supplier invoice no *" value={invoiceNo} onChangeText={setInvoiceNo} />
      <Field label="Invoice date (YYYY-MM-DD)" value={invoiceDate} onChangeText={setInvoiceDate} />
      <Field label="Paid now (₹, 0 = full credit)" keyboardType="numeric" value={paidAmount} onChangeText={setPaidAmount} />
      <Chips label="Paid via" value={paidMethod} onChange={setPaidMethod}
        options={['bank', 'cash', 'upi', 'cheque'].map(m => ({ value: m, label: m.toUpperCase() }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <TouchableOpacity onPress={startInvoicePhoto}
          style={{ backgroundColor: colors.brandLight, borderRadius: 8, padding: 10, flex: 1 }}>
          <Text style={{ color: colors.brand, fontWeight: '700' }}>
            {invoiceFile ? '📎 Invoice photo attached — retake' : '📷 Attach supplier invoice photo'}
          </Text>
        </TouchableOpacity>
        {!!invoiceFile && (
          <TouchableOpacity onPress={() => setInvoiceFile(null)} style={{ padding: 10 }}>
            <Text style={{ color: colors.red, fontWeight: '800' }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 6 }}>
        <Text style={{ flex: 1, fontWeight: '800', fontSize: 15 }}>Items ({items.length})</Text>
        <Text style={{ color: colors.ink3, fontSize: 12 }}>Auto-saved as draft</Text>
      </View>
      {items.map((it, i) => (
        <TouchableOpacity key={i} onPress={() => openEdit(i)}
          style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700' }}>{it.name}{it.isNew && <Text style={{ color: colors.green, fontSize: 11 }}>  NEW</Text>}</Text>
            <Text style={{ fontWeight: '700', color: colors.green }}>{fmt((Number(it.qty) || 0) * (Number(it.purchase_price) || 0))}</Text>
          </View>
          <Text style={{ color: colors.ink3, fontSize: 12 }}>{it.brand} · {it.generic_name} · {it.strip_count}/strip</Text>
          <Text style={{ color: colors.ink3, fontSize: 12 }}>Batch {it.batch_no} · Exp {it.expiry_date} · Qty {it.qty}{it.free_qty ? ` +${it.free_qty} free` : ''}</Text>
        </TouchableOpacity>
      ))}
      <Btn title="＋ Add Item" onPress={openNew} />

      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 8 }, shadow]}>
        <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 10 }}>Total: {fmt(total)}</Text>
        <Btn title={busy ? 'Saving…' : '💾 Save Purchase'} color={colors.green} disabled={busy} onPress={save} />
        <Btn title="Discard draft" color={colors.red} onPress={discardDraft} />
      </View>

      {/* Supplier picker */}
      <Modal visible={supplierPick} transparent animationType="fade" onRequestClose={() => setSupplierPick(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'center', padding: 20 }}>
          <View style={[{ backgroundColor: '#fff', borderRadius: 14, padding: 8, maxHeight: '70%' }, shadow]}>
            <Text style={{ fontWeight: '800', padding: 10 }}>Choose supplier</Text>
            <ScrollView>
              {suppliers.map(s => (
                <TouchableOpacity key={s.id} onPress={() => { setSupplierId(String(s.id)); setSupplierPick(false); }}
                  style={{ padding: 13, borderTopWidth: 1, borderColor: colors.line }}>
                  <Text style={{ fontWeight: '600' }}>{s.name}</Text>
                  {s.balance > 0 && <Text style={{ color: colors.red, fontSize: 12 }}>Due {fmt(s.balance)}</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Btn title="Close" color={colors.ink3} onPress={() => setSupplierPick(false)} />
          </View>
        </View>
      </Modal>

      {/* Item add/edit modal */}
      <Modal visible={editIdx !== null} animationType="slide" onRequestClose={() => setEditIdx(null)}>
        <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{editIdx === -1 ? 'Add item' : 'Edit item'}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label="Medicine name *" value={draft.name}
                onChangeText={v => setDraft(x => ({ ...x, name: v }))}
                onEndEditing={e => e.nativeEvent.text.trim() && lookupMedicine(e.nativeEvent.text.trim())} />
            </View>
            <TouchableOpacity onPress={startScan} style={{ backgroundColor: colors.brand, borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <Text style={{ color: '#fff' }}>📷</Text>
            </TouchableOpacity>
          </View>
          {draft.isNew && <Text style={{ color: colors.green, fontSize: 12, marginBottom: 8 }}>New medicine — brand, generic & strip count will create it.</Text>}
          <PickerField label="Brand name *" value={draft.brand} onChange={v => setDraft(x => ({ ...x, brand: v }))} endpoint="/inventory/brands" listKey="brands" />
          <PickerField label="Generic name *" value={draft.generic_name} onChange={v => setDraft(x => ({ ...x, generic_name: v }))} endpoint="/inventory/generics" listKey="generics" />
          <Field label="Strip count (tabs/caps per strip) *" keyboardType="numeric" value={String(draft.strip_count)} onChangeText={v => setDraft(x => ({ ...x, strip_count: v }))} />
          <Field label="Batch number *" autoCapitalize="characters" value={draft.batch_no} onChangeText={v => setDraft(x => ({ ...x, batch_no: v }))} />
          <Field label="Expiry (MM/YYYY) *" keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} placeholder="e.g. 08/2027" value={draft.expiry_date} onChangeText={v => setDraft(x => ({ ...x, expiry_date: v }))} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Quantity *" keyboardType="numeric" value={String(draft.qty)} onChangeText={v => setDraft(x => ({ ...x, qty: v }))} /></View>
            <View style={{ flex: 1 }}><Field label="Free qty" keyboardType="numeric" value={String(draft.free_qty)} onChangeText={v => setDraft(x => ({ ...x, free_qty: v }))} /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Cost price *" keyboardType="numeric" value={String(draft.purchase_price)} onChangeText={v => setDraft(x => ({ ...x, purchase_price: v }))} /></View>
            <View style={{ flex: 1 }}><Field label="MRP *" keyboardType="numeric" value={String(draft.mrp)} onChangeText={v => setDraft(x => ({ ...x, mrp: v }))} /></View>
            <View style={{ flex: 1 }}><Field label="Selling" keyboardType="numeric" value={String(draft.selling_price)} onChangeText={v => setDraft(x => ({ ...x, selling_price: v }))} /></View>
          </View>
          <Btn title="Save Item" color={colors.green} onPress={saveItem} />
          {editIdx !== -1 && <Btn title="Remove Item" color={colors.red} onPress={() => { setItems(l => l.filter((_, i) => i !== editIdx)); setEditIdx(null); }} />}
          <Btn title="Cancel" color={colors.ink3} onPress={() => setEditIdx(null)} />
        </ScrollView>
      </Modal>

      <Modal visible={scanning} animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={camRef} style={{ flex: 1 }} onBarcodeScanned={photoMode ? undefined : onScan}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }} />
          {photoMode && (
            <TouchableOpacity onPress={snapInvoice} style={{ backgroundColor: colors.green, padding: 16 }}>
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>📸 Capture invoice</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { setScanning(false); setPhotoMode(false); }} style={{ backgroundColor: colors.red, padding: 16 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}
