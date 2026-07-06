import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Modal, ScrollView, TouchableOpacity, Alert, Linking } from 'react-native';
import { api, fmt } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { colors, shadow } from '../theme';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';

const blank = {
  name: '', phone: '', email: '', address: '', dob: '', credit_limit: '', notes: '',
  gstin: '', customer_type: 'individual', discount_percent: '',
};

export default function CustomersScreen() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const [tab, setTab] = useState('all'); // all | dues
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [dues, setDues] = useState({ dues: [], total: 0 });
  const [edit, setEdit] = useState(null);
  const [profile, setProfile] = useState(null);
  const [paying, setPaying] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const debounce = useRef(null);

  const load = () => {
    api('/customers', { params: { q, branch_id: branchId, limit: 100 } }).then(d => setRows(d.customers)).catch(() => {});
    api('/customers/dues/list', { params: { branch_id: branchId } }).then(setDues).catch(() => {});
  };
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
  }, [q, branchId]);

  const save = async () => {
    if (!edit.name || !edit.phone) return Alert.alert('Missing details', 'Name and mobile number are required.');
    setBusy(true);
    try {
      const body = {
        ...edit, dob: edit.dob || null,
        credit_limit: Number(edit.credit_limit) || 0,
        discount_percent: Number(edit.discount_percent) || 0,
      };
      if (edit.id) await api(`/customers/${edit.id}`, { method: 'PUT', body });
      else await api('/customers', { method: 'POST', body });
      setEdit(null); load();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };

  const openEdit = c => setEdit({
    id: c.id, name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '',
    dob: (c.dob || '').slice(0, 10), credit_limit: c.credit_limit ? String(c.credit_limit) : '',
    notes: c.notes || '', gstin: c.gstin || '', customer_type: c.customer_type || 'individual',
    discount_percent: c.discount_percent ? String(c.discount_percent) : '',
  });

  const openProfile = c => api(`/customers/${c.id}`).then(setProfile).catch(e => Alert.alert('Error', e.message));

  const remind = async c => {
    try {
      const d = await api(`/customers/${c.id}/reminder`);
      if (d.whatsapp_url) Linking.openURL(d.whatsapp_url);
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const receive = async () => {
    setBusy(true);
    try {
      const d = await api(`/customers/${paying.id}/payments`, { method: 'POST', body: { amount: Number(payAmount), method: payMethod } });
      Alert.alert('Payment received', `Remaining due: ${fmt(d.credit_balance)}`);
      setPaying(null); load();
    } catch (e) { Alert.alert('Error', e.message); }
    setBusy(false);
  };

  const exportCustomers = () => shareCsv('customers.csv', [
    { key: 'name', label: 'Name' }, { key: 'phone', label: 'Mobile' },
    { key: 'branch_name', label: 'Branch' }, { key: 'total_bills', label: 'Bills' },
    { key: 'total_spent', label: 'Total spent' }, { key: 'loyalty_points', label: 'Points' },
    { key: 'credit_balance', label: 'Credit due' }, { key: 'last_purchase', label: 'Last purchase' },
  ], rows);

  const exportDues = () => shareCsv('customer-credit-dues.csv', [
    { key: 'name', label: 'Customer' }, { key: 'phone', label: 'Mobile' },
    { key: 'credit_balance', label: 'Credit due' },
  ], dues.dues);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      <Chips value={tab} onChange={setTab} options={[
        { value: 'all', label: `👥 Customers (${rows.length})` },
        { value: 'dues', label: `💳 Credit Dues (${dues.dues.length})` },
      ]} />

      {tab === 'all' && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {can(user, 'customers.manage') && (
              <View style={{ flex: 1 }}><Btn title="＋ New Customer" onPress={() => setEdit({ ...blank })} /></View>
            )}
            <View style={{ flex: 1 }}><Btn title="⬇ Export CSV" color={colors.ink2} onPress={exportCustomers} /></View>
          </View>
          <TextInput
            style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 10 }}
            placeholder="Search customer name or mobile…" value={q} onChangeText={setQ} />
          <FlatList
            data={rows}
            keyExtractor={r => String(r.id)}
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => openProfile(item)}
                style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700' }}>
                    {item.name}
                    {item.customer_type === 'business' && <Text style={{ color: colors.orange, fontSize: 11 }}>  BUSINESS</Text>}
                    {Number(item.discount_percent) > 0 && <Text style={{ color: colors.green, fontSize: 11 }}>  {item.discount_percent}% OFF</Text>}
                  </Text>
                  <Text style={{ color: colors.brand }}>{Math.round(item.loyalty_points)} ⭐</Text>
                </View>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.phone} · {item.total_bills} bills · spent {fmt(item.total_spent)}</Text>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>
                  Last purchase: {item.last_purchase ? String(item.last_purchase).slice(0, 10) : '—'}
                </Text>
                {!!item.gstin && <Text style={{ color: colors.ink3, fontSize: 12 }}>GST: {item.gstin}</Text>}
                {item.credit_balance > 0 && (
                  <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12, marginTop: 2 }}>Credit due: {fmt(item.credit_balance)}</Text>
                )}
                {can(user, 'customers.manage') && (
                  <TouchableOpacity onPress={() => openEdit(item)} style={{ position: 'absolute', right: 10, bottom: 10 }}>
                    <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>✏️ Edit</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            )}
          />
        </>
      )}

      {tab === 'dues' && (
        <>
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' }, shadow]}>
            <Text style={{ fontWeight: '700' }}>Total outstanding</Text>
            <Text style={{ fontWeight: '800', color: colors.red }}>{fmt(dues.total)}</Text>
          </View>
          <Btn title="⬇ Export CSV" color={colors.ink2} onPress={exportDues} />
          <FlatList
            data={dues.dues}
            keyExtractor={r => String(r.id)}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No credit dues 🎉</Text>}
            renderItem={({ item }) => (
              <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                  <Text style={{ fontWeight: '800', color: colors.red }}>{fmt(item.credit_balance)}</Text>
                </View>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.phone}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {can(user, 'billing.create', 'accounts.manage') && (
                    <TouchableOpacity onPress={() => { setPaying(item); setPayAmount(String(item.credit_balance)); setPayMethod('cash'); }}
                      style={{ backgroundColor: colors.green, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Receive payment</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => remind(item)}
                    style={{ backgroundColor: colors.orange, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>📱 Remind</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </>
      )}

      {/* Add / edit customer */}
      <Modal visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        {edit && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{edit.id ? `Edit ${edit.name}` : 'New Customer'}</Text>
            <Field label="Full name *" value={edit.name} onChangeText={v => setEdit(e => ({ ...e, name: v }))} />
            <Field label="Mobile number *" keyboardType="phone-pad" value={edit.phone} onChangeText={v => setEdit(e => ({ ...e, phone: v }))} />
            <Chips label="Customer type" value={edit.customer_type} onChange={v => setEdit(e => ({ ...e, customer_type: v }))}
              options={[{ value: 'individual', label: 'Individual' }, { value: 'business', label: 'Business (GST)' }]} />
            <Field label="GST number (business, optional)" autoCapitalize="characters" value={edit.gstin} onChangeText={v => setEdit(e => ({ ...e, gstin: v }))} />
            <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={edit.email} onChangeText={v => setEdit(e => ({ ...e, email: v }))} />
            <Field label="Date of birth (YYYY-MM-DD)" placeholder="1990-01-31" value={edit.dob} onChangeText={v => setEdit(e => ({ ...e, dob: v }))} />
            <Field label="Credit limit (₹)" keyboardType="numeric" value={String(edit.credit_limit)} onChangeText={v => setEdit(e => ({ ...e, credit_limit: v }))} />
            <Field label="Special discount % (auto-offered at billing)" keyboardType="numeric"
              value={String(edit.discount_percent)} onChangeText={v => setEdit(e => ({ ...e, discount_percent: v }))} />
            <Field label="Address" value={edit.address} onChangeText={v => setEdit(e => ({ ...e, address: v }))} />
            <Field label="Notes" value={edit.notes} onChangeText={v => setEdit(e => ({ ...e, notes: v }))} />
            <Btn title={busy ? 'Saving…' : '💾 Save Customer'} color={colors.green} onPress={save} disabled={busy} />
            <Btn title="Cancel" color={colors.ink3} onPress={() => setEdit(null)} />
          </ScrollView>
        )}
      </Modal>

      {/* Receive payment */}
      <Modal visible={!!paying} transparent animationType="fade" onRequestClose={() => setPaying(null)}>
        {paying && (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'center', padding: 24 }}>
            <View style={[{ backgroundColor: '#fff', borderRadius: 14, padding: 16 }, shadow]}>
              <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 4 }}>Receive payment — {paying.name}</Text>
              <Text style={{ color: colors.ink3, marginBottom: 10 }}>Credit due: {fmt(paying.credit_balance)}</Text>
              <Field label="Amount *" keyboardType="numeric" value={payAmount} onChangeText={setPayAmount} />
              <Chips label="Method" value={payMethod} onChange={setPayMethod}
                options={['cash', 'upi', 'card'].map(m => ({ value: m, label: m.toUpperCase() }))} />
              <Btn title={busy ? 'Saving…' : '💾 Save'} color={colors.green} onPress={receive} disabled={busy || !Number(payAmount)} />
              <Btn title="Cancel" color={colors.ink3} onPress={() => setPaying(null)} />
            </View>
          </View>
        )}
      </Modal>

      {/* Customer profile */}
      <Modal visible={!!profile} animationType="slide" onRequestClose={() => setProfile(null)}>
        {profile && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>{profile.customer.name}</Text>
            <Text style={{ color: colors.ink3, marginBottom: 12 }}>{profile.customer.phone}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {[['Points', Math.round(profile.customer.loyalty_points) + ' ⭐'],
                ['Credit due', fmt(profile.customer.credit_balance)],
                ['Bills', String(profile.sales.length)]].map(([l, v]) => (
                <View key={l} style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 10, flex: 1 }, shadow]}>
                  <Text style={{ fontSize: 10, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>{l}</Text>
                  <Text style={{ fontWeight: '800', marginTop: 2 }}>{v}</Text>
                </View>
              ))}
            </View>
            {profile.top_items.length > 0 && (
              <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12 }, shadow]}>
                <Text style={{ fontWeight: '700', marginBottom: 8 }}>Frequently bought</Text>
                {profile.top_items.map(t => (
                  <View key={t.name} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ color: colors.ink2, flex: 1 }} numberOfLines={1}>{t.name}</Text>
                    <Text style={{ fontWeight: '600' }}>{t.qty} qty · {t.times} bills</Text>
                  </View>
                ))}
              </View>
            )}
            {profile.monthly.length > 0 && (
              <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12 }, shadow]}>
                <Text style={{ fontWeight: '700', marginBottom: 8 }}>Monthly purchases</Text>
                {profile.monthly.map(m => (
                  <View key={m.month} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ color: colors.ink2 }}>{m.month}</Text>
                    <Text style={{ fontWeight: '600' }}>{fmt(m.amount)} · {m.bills} bills</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12 }, shadow]}>
              <Text style={{ fontWeight: '700', marginBottom: 8 }}>Purchase history</Text>
              {profile.sales.map(sl => (
                <View key={sl.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '600' }}>{sl.invoice_no}</Text>
                    <Text style={{ fontWeight: '700' }}>{fmt(sl.total)}</Text>
                  </View>
                  <Text style={{ color: colors.ink3, fontSize: 12 }}>
                    {String(sl.created_at).slice(0, 10)} · {sl.branch_name || ''} · {sl.status}
                    {sl.credit_amount > 0 ? ` · on credit ${fmt(sl.credit_amount)}` : ''}
                  </Text>
                </View>
              ))}
              {profile.sales.length === 0 && <Text style={{ color: colors.ink3 }}>No purchases yet</Text>}
            </View>
            <Btn title="Close" color={colors.ink3} onPress={() => setProfile(null)} />
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}
