import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, ScrollView, TouchableOpacity, TextInput, Alert, Modal, Image, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, fmt, BASE_URL, getAuthToken } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const card = [{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow];

function CsvBtn({ filename, columns, rows }) {
  return (
    <TouchableOpacity onPress={() => shareCsv(filename, columns, rows)}
      style={{ backgroundColor: colors.brandLight, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'flex-end', marginBottom: 8 }}>
      <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>⬇ CSV</Text>
    </TouchableOpacity>
  );
}

export default function PurchasesScreen({ navigation }) {
  const { user } = useAuth();
  const { branchId, options } = useBranch();
  const activeBranch = Number(branchId) || options[0]?.id || user.branch_id;
  const [tab, setTab] = useState('invoices');
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar requireBranch />
      <Chips value={tab} onChange={setTab} options={[
        { value: 'invoices', label: '📦 Invoices' },
        { value: 'suppliers', label: '🏭 Suppliers' },
        { value: 'dues', label: '💸 Dues' },
        { value: 'returns', label: '↩ Returns' },
      ]} />
      {tab === 'invoices' && <InvoicesTab navigation={navigation} activeBranch={activeBranch} />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'dues' && <DuesTab />}
      {tab === 'returns' && <ReturnsTab activeBranch={activeBranch} />}
    </View>
  );
}

// ---------------- Invoices ----------------
const PURCHASE_CSV = [
  { key: 'invoice_no', label: 'Invoice' }, { key: 'invoice_date', label: 'Date' },
  { key: 'supplier_name', label: 'Supplier' }, { key: 'branch_name', label: 'Branch' },
  { key: 'subtotal', label: 'Subtotal' }, { key: 'gst_amount', label: 'GST' },
  { key: 'total', label: 'Total' }, { key: 'paid_amount', label: 'Paid' },
  { key: 'pending_amount', label: 'Pending' }, { key: 'status', label: 'Status' },
];

function InvoicesTab({ navigation, activeBranch }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [view, setView] = useState(null); // full purchase with items
  const [returning, setReturning] = useState(null);

  const load = useCallback(() => {
    api('/purchases', { params: { branch_id: activeBranch } })
      .then(d => setRows(d.purchases)).catch(() => {});
  }, [activeBranch]);
  useFocusEffect(load);

  const open = id => api(`/purchases/${id}`).then(d => setView(d.purchase))
    .catch(e => Alert.alert('Could not load purchase', e.message));

  const del = (p) => Alert.alert('Delete purchase?', `${p.invoice_no} — the stock it added will be reversed. Refused if any of its stock was already sold.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await api(`/purchases/${p.id}`, { method: 'DELETE' }); setView(null); load(); }
      catch (e) { Alert.alert('Cannot delete', e.message); }
    } },
  ]);

  const openInvoiceFile = (purchaseId) => Linking.openURL(`${BASE_URL}/api/purchases/${purchaseId}/invoice-file?token=${getAuthToken()}`)
    .catch(() => Alert.alert('Cannot open file', 'The attached invoice file cannot be opened on this device.'));

  return (
    <View style={{ flex: 1 }}>
      {can(user, 'purchases.manage') && (
        <Btn title="＋ New Purchase Entry" onPress={() => navigation.navigate('PurchaseEntry', { branchId: activeBranch })} />
      )}
      <CsvBtn filename="purchases.csv" columns={PURCHASE_CSV} rows={rows} />
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No purchases yet</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => open(item.id)} style={card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: colors.brand }}>{item.invoice_no}</Text>
              <Text style={{ fontWeight: '800', color: colors.green }}>{fmt(item.total)}</Text>
            </View>
            <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>{item.supplier_name}</Text>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {item.invoice_date} · {item.branch_name} · {item.status}
              {item.pending_amount > 0.01 ? ` · due ${fmt(item.pending_amount)}` : ' · paid'}
            </Text>
            {can(user, 'purchases.manage') && item.status !== 'returned' && (
              <TouchableOpacity onPress={() => del(item)} style={{ marginTop: 6 }}>
                <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12 }}>🗑 Delete (reverse stock)</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
      />

      {/* Purchase detail */}
      <Modal visible={!!view} animationType="slide" onRequestClose={() => setView(null)}>
        {view && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>Purchase {view.invoice_no}</Text>
            <Text style={{ color: colors.ink2, marginBottom: 12 }}>{view.supplier_name} · {view.invoice_date} · {view.branch_name}</Text>
            {!!view.invoice_file && (
              view.invoice_file.startsWith('data:image')
                ? <Image source={{ uri: view.invoice_file }} resizeMode="contain"
                    style={{ width: '100%', height: 220, borderRadius: 10, marginBottom: 10, backgroundColor: '#fff' }} />
                : (
                  <TouchableOpacity onPress={() => openInvoiceFile(view.id)} style={{ marginBottom: 10 }}>
                    <Text style={{ color: colors.brand, fontWeight: '700' }}>📎 View uploaded supplier invoice</Text>
                  </TouchableOpacity>
                )
            )}
            {(view.items || []).map(it => (
              <View key={it.id} style={card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', flex: 1 }}>{it.medicine_name}</Text>
                  <Text style={{ fontWeight: '700', color: colors.green }}>{fmt(it.amount)}</Text>
                </View>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>{it.brand} · {it.generic_name} · {it.strip_count || 1}/strip</Text>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>Batch {it.batch_no} · Exp {it.expiry_date}</Text>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>
                  Qty {it.qty}{it.free_qty ? ` +${it.free_qty} free` : ''} · Cost {fmt(it.purchase_price)} · MRP {fmt(it.mrp)}
                </Text>
              </View>
            ))}
            <View style={[card, { alignItems: 'flex-end' }]}>
              <Text style={{ color: colors.ink3 }}>GST: {fmt(view.gst_amount)}</Text>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>Total: {fmt(view.total)}</Text>
              <Text style={{ color: view.total - view.paid_amount > 0.01 ? colors.red : colors.green, fontSize: 12 }}>
                Paid {fmt(view.paid_amount)}{view.total - view.paid_amount > 0.01 ? ` · pending ${fmt(view.total - view.paid_amount)}` : ''}
              </Text>
            </View>
            {can(user, 'purchases.manage') && view.status !== 'returned' && (
              <Btn title="↩ Return to supplier" color={colors.orange} onPress={() => { setReturning(view); setView(null); }} />
            )}
            {can(user, 'purchases.manage') && view.status !== 'returned' && (
              <Btn title="🗑 Delete (reverse stock)" color={colors.red} onPress={() => del(view)} />
            )}
            <Btn title="Close" color={colors.ink3} onPress={() => setView(null)} />
          </ScrollView>
        )}
      </Modal>

      {returning && <ReturnModal purchase={returning} onClose={() => setReturning(null)}
        onDone={() => { setReturning(null); load(); }} />}
    </View>
  );
}

// Mirrors web PurchaseReturnModal: per-batch return qty + reason → POST /purchases/:id/returns
function ReturnModal({ purchase, onClose, onDone }) {
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const refund = purchase.items.reduce((a, it) => a + (Number(qty[it.id]) || 0) * it.purchase_price, 0);
  const submit = async () => {
    const sel = purchase.items.filter(it => Number(qty[it.id]) > 0)
      .map(it => ({ purchase_item_id: it.id, qty: Number(qty[it.id]) }));
    if (!sel.length) return Alert.alert('Enter return quantities');
    setBusy(true);
    try {
      const d = await api(`/purchases/${purchase.id}/returns`, { method: 'POST', body: { items: sel, reason } });
      Alert.alert('Return recorded', `${fmt(d.amount)} adjusted against supplier`);
      onDone();
    } catch (e) { Alert.alert('Could not record return', e.message); }
    setBusy(false);
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>Return to {purchase.supplier_name}</Text>
        {purchase.items.map(it => (
          <View key={it.id} style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }}>{it.medicine_name}</Text>
              <Text style={{ color: colors.ink3, fontSize: 12 }}>Batch {it.batch_no} · purchased {it.qty}</Text>
            </View>
            <TextInput keyboardType="numeric" placeholder="0" placeholderTextColor={colors.ink3}
              value={String(qty[it.id] || '')} onChangeText={v => setQty(q => ({ ...q, [it.id]: v }))}
              style={{ width: 70, textAlign: 'right', backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.line, padding: 8 }} />
          </View>
        ))}
        <Field label="Reason" placeholder="e.g. damaged in transit, near expiry" value={reason} onChangeText={setReason} />
        <Text style={{ fontWeight: '800', fontSize: 15, marginBottom: 8 }}>Return value: {fmt(refund)}</Text>
        <Btn title={busy ? 'Saving…' : '↩ Confirm Return'} color={colors.orange} disabled={busy} onPress={submit} />
        <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

// ---------------- Suppliers ----------------
const SUPPLIER_CSV = [
  { key: 'name', label: 'Supplier' }, { key: 'contact_person', label: 'Contact' },
  { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
  { key: 'gstin', label: 'GSTIN' }, { key: 'balance', label: 'Balance due' },
];

function SuppliersTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null); // {} = new, row = edit
  const [ledger, setLedger] = useState(null);
  const [paying, setPaying] = useState(null);

  const load = useCallback(() => {
    api('/purchases/suppliers').then(d => setRows(d.suppliers)).catch(() => {});
  }, []);
  useFocusEffect(load);

  const openLedger = s => api(`/purchases/suppliers/${s.id}/ledger`).then(setLedger)
    .catch(e => Alert.alert('Could not load ledger', e.message));

  return (
    <View style={{ flex: 1 }}>
      {can(user, 'suppliers.manage') && <Btn title="＋ Add Supplier" onPress={() => setEdit({})} />}
      <CsvBtn filename="suppliers.csv" columns={SUPPLIER_CSV} rows={rows} />
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No suppliers yet</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => openLedger(item)} style={card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: colors.brand }}>{item.name}</Text>
              {item.balance > 0
                ? <Text style={{ fontWeight: '800', color: colors.red }}>{fmt(item.balance)}</Text>
                : <Text style={{ fontWeight: '700', color: colors.green, fontSize: 12 }}>clear</Text>}
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {[item.contact_person, item.phone, item.gstin].filter(Boolean).join(' · ') || '—'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
              {can(user, 'accounts.manage', 'purchases.manage') && item.balance > 0 && (
                <TouchableOpacity onPress={() => setPaying(item)}>
                  <Text style={{ color: colors.green, fontWeight: '700', fontSize: 12 }}>💰 Pay</Text>
                </TouchableOpacity>
              )}
              {can(user, 'suppliers.manage') && (
                <TouchableOpacity onPress={() => setEdit(item)}>
                  <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>✏️ Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
      {edit && <SupplierModal s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {paying && <PaySupplierModal s={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load(); }} />}

      {/* Ledger */}
      <Modal visible={!!ledger} animationType="slide" onRequestClose={() => setLedger(null)}>
        {ledger && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>Ledger — {ledger.supplier.name}</Text>
            <Text style={{ color: colors.ink2, marginBottom: 12 }}>
              Opening balance: {fmt(ledger.opening_balance)} · Current due:{' '}
              <Text style={{ fontWeight: '800', color: ledger.balance > 0 ? colors.red : colors.green }}>{fmt(ledger.balance)}</Text>
            </Text>
            {ledger.ledger.length === 0 && <Text style={{ color: colors.ink3, textAlign: 'center', marginTop: 20 }}>No entries yet</Text>}
            {ledger.ledger.map(r => (
              <View key={`${r.type}-${r.id}`} style={card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700' }}>{r.type}{r.invoice_no ? ` · ${r.invoice_no}` : ''}</Text>
                  <Text style={{ fontWeight: '700', color: r.debit ? colors.red : colors.green }}>
                    {r.debit ? `+${fmt(r.debit)}` : `-${fmt(r.credit)}`}
                  </Text>
                </View>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>{r.date} · balance {fmt(r.balance)}</Text>
              </View>
            ))}
            <Btn title="Close" color={colors.ink3} onPress={() => setLedger(null)} />
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}

function SupplierModal({ s, onClose, onSaved }) {
  const [f, setF] = useState({
    name: s.name || '', contact_person: s.contact_person || '', phone: s.phone || '', email: s.email || '',
    address: s.address || '', gstin: s.gstin || '', drug_license: s.drug_license || '',
    opening_balance: String(s.opening_balance ?? 0), payment_terms: s.payment_terms || '',
  });
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return Alert.alert('Supplier name is required');
    setBusy(true);
    try {
      const body = { ...f, opening_balance: Number(f.opening_balance) || 0 };
      if (s.id) await api(`/purchases/suppliers/${s.id}`, { method: 'PUT', body });
      else await api('/purchases/suppliers', { method: 'POST', body });
      onSaved();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{s.id ? `Edit ${s.name}` : 'Add supplier'}</Text>
        <Field label="Name *" value={f.name} onChangeText={set('name')} />
        <Field label="Contact person" value={f.contact_person} onChangeText={set('contact_person')} />
        <Field label="Phone" keyboardType="phone-pad" value={f.phone} onChangeText={set('phone')} />
        <Field label="Email" keyboardType="email-address" autoCapitalize="none" value={f.email} onChangeText={set('email')} />
        <Field label="GSTIN" autoCapitalize="characters" value={f.gstin} onChangeText={set('gstin')} />
        <Field label="Drug license" value={f.drug_license} onChangeText={set('drug_license')} />
        <Field label="Opening balance (₹)" keyboardType="numeric" value={f.opening_balance} onChangeText={set('opening_balance')} />
        <Field label="Payment terms" placeholder="e.g. Net 30 days" value={f.payment_terms} onChangeText={set('payment_terms')} />
        <Field label="Address" value={f.address} onChangeText={set('address')} />
        <Btn title={busy ? 'Saving…' : '💾 Save Supplier'} color={colors.green} disabled={busy} onPress={save} />
        <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

function PaySupplierModal({ s, onClose, onDone }) {
  const [amount, setAmount] = useState(String(s.balance || ''));
  const [method, setMethod] = useState('bank');
  const [refNo, setRefNo] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!Number(amount) || Number(amount) <= 0) return Alert.alert('Enter a valid amount');
    setBusy(true);
    try {
      await api(`/purchases/suppliers/${s.id}/payments`, { method: 'POST', body: { amount: Number(amount), method, ref_no: refNo } });
      Alert.alert('Payment recorded');
      onDone();
    } catch (e) { Alert.alert('Could not record payment', e.message); }
    setBusy(false);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'center', padding: 20 }}>
        <View style={[{ backgroundColor: '#fff', borderRadius: 14, padding: 14 }, shadow]}>
          <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 4 }}>Pay {s.name}</Text>
          <Text style={{ color: colors.ink2, marginBottom: 10 }}>Current due: <Text style={{ fontWeight: '800' }}>{fmt(s.balance)}</Text></Text>
          <Field label="Amount *" keyboardType="numeric" value={amount} onChangeText={setAmount} />
          <Chips label="Method" value={method} onChange={setMethod} options={[
            { value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' },
            { value: 'upi', label: 'UPI' }, { value: 'cheque', label: 'Cheque' },
          ]} />
          <Field label="Reference no" value={refNo} onChangeText={setRefNo} />
          <Btn title={busy ? 'Saving…' : '💰 Record Payment'} color={colors.green} disabled={busy} onPress={save} />
          <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

// ---------------- Dues ----------------
function DuesTab() {
  const [d, setD] = useState(null);
  const load = useCallback(() => {
    api('/purchases/dues/summary').then(setD).catch(() => {});
  }, []);
  useFocusEffect(load);
  if (!d) return null;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flex: 1, fontWeight: '800' }}>Pending dues — total <Text style={{ color: colors.red }}>{fmt(d.total)}</Text></Text>
        <CsvBtn filename="supplier-dues.csv" rows={d.dues} columns={[
          { key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, { key: 'balance', label: 'Due' },
        ]} />
      </View>
      <FlatList
        data={d.dues}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No pending dues 🎉</Text>}
        renderItem={({ item }) => (
          <View style={[card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <View>
              <Text style={{ fontWeight: '700' }}>{item.name}</Text>
              {!!item.phone && <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.phone}</Text>}
            </View>
            <Text style={{ fontWeight: '800', color: colors.red }}>{fmt(item.balance)}</Text>
          </View>
        )}
      />
    </View>
  );
}

// ---------------- Returns ----------------
const RETURN_CSV = [
  { key: 'created_at', label: 'Date' }, { key: 'supplier_name', label: 'Supplier' },
  { key: 'invoice_no', label: 'Against invoice' }, { key: 'branch_name', label: 'Branch' },
  { key: 'reason', label: 'Reason' }, { key: 'amount', label: 'Amount' },
];

function ReturnsTab({ activeBranch }) {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => {
    api('/purchases/returns/list', { params: { branch_id: activeBranch } })
      .then(d => setRows(d.returns)).catch(() => {});
  }, [activeBranch]);
  useFocusEffect(load);
  return (
    <View style={{ flex: 1 }}>
      <CsvBtn filename="purchase-returns.csv" columns={RETURN_CSV} rows={rows} />
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No purchase returns yet</Text>}
        renderItem={({ item }) => (
          <View style={card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{item.supplier_name}</Text>
              <Text style={{ fontWeight: '800', color: colors.orange }}>{fmt(item.amount)}</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {String(item.created_at).slice(0, 10)} · {item.branch_name}
              {item.invoice_no ? ` · against ${item.invoice_no}` : ''}
            </Text>
            {!!item.reason && <Text style={{ color: colors.ink2, fontSize: 12, marginTop: 2 }}>{item.reason}</Text>}
          </View>
        )}
      />
    </View>
  );
}
