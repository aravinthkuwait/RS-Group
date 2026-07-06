import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Modal, ScrollView, TouchableOpacity, Alert, Image, Linking } from 'react-native';
import { api, fmt, BASE_URL, getAuthToken } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthStart = () => today().slice(0, 8) + '01';

const STATUS = [{ value: '', label: 'All' }, ...['completed', 'cancelled', 'returned', 'partial_return', 'held']
  .map(s => ({ value: s, label: s.replace('_', ' ') }))];
const PAYMENT = [{ value: '', label: 'All' }, ...['cash', 'upi', 'card', 'credit']
  .map(p => ({ value: p, label: p.toUpperCase() }))];
const CSV_COLUMNS = [
  { key: 'invoice_no', label: 'Invoice' }, { key: 'created_at', label: 'Date' },
  { key: 'branch_name', label: 'Branch' }, { key: 'customer_name', label: 'Customer' },
  { key: 'staff_name', label: 'Staff' }, { key: 'subtotal', label: 'Subtotal' },
  { key: 'discount', label: 'Discount' }, { key: 'total', label: 'Total' },
  { key: 'paid_cash', label: 'Cash' }, { key: 'paid_upi', label: 'UPI' },
  { key: 'paid_card', label: 'Card' }, { key: 'credit_amount', label: 'Credit' },
  { key: 'status', label: 'Status' },
];

const paidVia = r => [r.paid_cash > 0 && 'Cash', r.paid_upi > 0 && 'UPI', r.paid_card > 0 && 'Card',
  r.credit_amount > 0 && 'Credit'].filter(Boolean).join(' + ') || '—';

const statusColor = s => ({ completed: colors.green, held: colors.orange, cancelled: colors.red,
  returned: colors.red, partial_return: colors.orange }[s] || colors.ink3);

function Badge({ status }) {
  return (
    <View style={{ backgroundColor: statusColor(status) + '22', borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8 }}>
      <Text style={{ color: statusColor(status), fontWeight: '700', fontSize: 11 }}>{status.replace('_', ' ')}</Text>
    </View>
  );
}

function Row({ label, children }) {
  return (
    <View style={{ minWidth: '46%', flex: 1, marginBottom: 8 }}>
      <Text style={{ fontSize: 11, color: colors.ink3, fontWeight: '700' }}>{label}</Text>
      {typeof children === 'string' ? <Text style={{ fontWeight: '700' }}>{children}</Text> : children}
    </View>
  );
}

const cell = (flex, right) => ({ flex, fontSize: 12, textAlign: right ? 'right' : 'left' });

export default function SalesScreen() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ from: monthStart(), to: today(), status: '', payment: '', q: '' });
  const [dq, setDq] = useState('');
  const [view, setView] = useState(null);
  const [returning, setReturning] = useState(null);
  const [showRx, setShowRx] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setDq(filters.q), 300);
  }, [filters.q]);

  const load = () => api('/sales', { params: { ...filters, q: dq, branch_id: branchId, limit: 100 } })
    .then(d => { setRows(d.sales); setTotal(d.total); }).catch(e => Alert.alert('Error', e.message));
  useEffect(() => { load(); }, [branchId, filters.from, filters.to, filters.status, filters.payment, dq]);

  const openBill = id => api(`/sales/${id}`).then(d => { setShowRx(false); setView(d.sale); })
    .catch(e => Alert.alert('Error', e.message));

  const cancel = (s) => {
    Alert.alert('Cancel bill?', `Cancel bill ${s.invoice_no}? Stock will be restored.`, [
      { text: 'No', style: 'cancel' },
      { text: 'Cancel bill', style: 'destructive', onPress: async () => {
        try {
          await api(`/sales/${s.id}/cancel`, { method: 'POST', body: {} });
          Alert.alert('Done', 'Bill cancelled and stock restored');
          setView(null); load();
        } catch (e) { Alert.alert('Error', e.message); }
      } },
    ]);
  };

  const openPdf = id => Linking.openURL(`${BASE_URL}/api/sales/${id}/pdf?token=${getAuthToken()}`)
    .catch(e => Alert.alert('Error', e.message));

  const gross = view ? (view.subtotal || 0) + (view.item_discount || 0) : 0;
  const discountLabel = view ? (
    view.discount_type === 'promo' && view.promo_name ? `Offer "${view.promo_name}"`
      : view.discount_type === 'customer' ? `Customer discount (${view.discount_value}%)`
      : view.discount_type === 'percent' ? `Discount (${view.discount_value}%)` : 'Discount'
  ) : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Field label="From" placeholder="YYYY-MM-DD" value={filters.from}
          onChangeText={v => setFilters(f => ({ ...f, from: v }))} /></View>
        <View style={{ flex: 1 }}><Field label="To" placeholder="YYYY-MM-DD" value={filters.to}
          onChangeText={v => setFilters(f => ({ ...f, to: v }))} /></View>
      </View>
      <Chips label="Status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))} options={STATUS} />
      <Chips label="Payment" value={filters.payment} onChange={v => setFilters(f => ({ ...f, payment: v }))} options={PAYMENT} />
      <Field label="Search" placeholder="Invoice / customer / phone" value={filters.q}
        onChangeText={v => setFilters(f => ({ ...f, q: v }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flex: 1, color: colors.ink3, fontSize: 12 }}>
          {total} bills · {fmt(rows.reduce((a, r) => a + r.total, 0))} shown
        </Text>
        <TouchableOpacity onPress={() => shareCsv('sales-bills.csv', CSV_COLUMNS, rows)}
          style={{ backgroundColor: colors.brandLight, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>⬇ CSV</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No bills match these filters</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => openBill(item.id)}
            style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.brand }}>{item.invoice_no}</Text>
              <Text style={{ fontWeight: '800' }}>{fmt(item.total)}</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {item.created_at} · {item.branch_name} · {item.staff_name}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: colors.ink2 }}>
                {item.customer_name || 'Walk-in'} · {paidVia(item)}
              </Text>
              <Badge status={item.status} />
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!view} animationType="slide" onRequestClose={() => setView(null)}>
        {view && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>Bill {view.invoice_no}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Row label="BRANCH">{view.branch_name}</Row>
              <Row label="DATE">{String(view.created_at)}</Row>
              <Row label="CUSTOMER">
                <Text style={{ fontWeight: '700' }}>{view.customer_name || 'Walk-in'}
                  {!!view.customer_phone && <Text style={{ fontWeight: '400', color: colors.ink2 }}> {view.customer_phone}</Text>}
                </Text>
              </Row>
              <Row label="STAFF">{view.staff_name || '—'}</Row>
              <Row label="STATUS"><View style={{ alignSelf: 'flex-start', marginTop: 2 }}><Badge status={view.status} /></View></Row>
            </View>
            {!!view.doctor_name && <Text style={{ color: colors.ink3, marginBottom: 8 }}>Doctor: {view.doctor_name}</Text>}
            {!!view.prescription_file && (
              <View style={{ marginBottom: 10 }}>
                {view.prescription_file.startsWith('data:image') ? (
                  <>
                    <TouchableOpacity onPress={() => setShowRx(s => !s)}>
                      <Text style={{ color: colors.brand, fontWeight: '700' }}>
                        📎 {showRx ? 'Hide' : 'View'} uploaded prescription
                      </Text>
                    </TouchableOpacity>
                    {showRx && (
                      <Image source={{ uri: view.prescription_file }} resizeMode="contain"
                        style={{ width: '100%', height: 320, marginTop: 8, backgroundColor: '#fff', borderRadius: 10 }} />
                    )}
                  </>
                ) : (
                  // Non-image (e.g. PDF uploaded from web) — Image can't render it and
                  // Android can't open data: URLs, so serve it from the API instead.
                  <TouchableOpacity onPress={() => Linking.openURL(`${BASE_URL}/api/sales/${view.id}/prescription-file?token=${getAuthToken()}`)}>
                    <Text style={{ color: colors.brand, fontWeight: '700' }}>📎 Open uploaded prescription</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 10 }, shadow]}>
              <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line, paddingBottom: 6, marginBottom: 6 }}>
                <Text style={[cell(3), { fontWeight: '700' }]}>Item</Text>
                <Text style={[cell(1, true), { fontWeight: '700' }]}>Qty</Text>
                <Text style={[cell(1, true), { fontWeight: '700' }]}>Ret.</Text>
                <Text style={[cell(1.4, true), { fontWeight: '700' }]}>Price</Text>
                <Text style={[cell(1, true), { fontWeight: '700' }]}>GST%</Text>
                <Text style={[cell(1.6, true), { fontWeight: '700' }]}>Amount</Text>
              </View>
              {(view.items || []).map(i => (
                <View key={i.id} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                  <View style={{ flex: 3 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600' }}>{i.medicine_name}</Text>
                    <Text style={{ fontSize: 10, color: colors.ink3 }}>Batch {i.batch_no}</Text>
                  </View>
                  <Text style={cell(1, true)}>{i.qty}</Text>
                  <Text style={[cell(1, true), { color: colors.red }]}>{i.returned_qty || ''}</Text>
                  <Text style={cell(1.4, true)}>{fmt(i.price)}</Text>
                  <Text style={cell(1, true)}>{i.gst_rate}</Text>
                  <Text style={[cell(1.6, true), { fontWeight: '700' }]}>{fmt(i.total)}</Text>
                </View>
              ))}
            </View>

            <View style={{ alignItems: 'flex-end', marginBottom: 12 }}>
              <Text style={{ color: colors.ink3, fontSize: 12, textAlign: 'right' }}>
                Gross: {fmt(gross)}
                {view.item_discount > 0 && ` · Item discounts: −${fmt(view.item_discount)}`}
                {view.discount > 0 && ` · ${discountLabel}: −${fmt(view.discount)}`}
                {' '}· Taxable: {fmt((view.subtotal || 0) - (view.discount || 0) - (view.gst_amount || 0))} · GST incl.: {fmt(view.gst_amount)}
              </Text>
              {(view.discount > 0 || view.item_discount > 0) && (
                <Text style={{ color: colors.orange, fontWeight: '700', marginTop: 2 }}>
                  Saved {fmt((view.discount || 0) + (view.item_discount || 0))}
                  {!!view.discount_approved_by_name && <Text style={{ color: colors.ink3, fontWeight: '400' }}> · approved by {view.discount_approved_by_name}</Text>}
                </Text>
              )}
              <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 4 }}>Net Payable: {fmt(view.total)}</Text>
              <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 2 }}>
                {[view.paid_cash > 0 && `Cash ${fmt(view.paid_cash)}`, view.paid_upi > 0 && `UPI ${fmt(view.paid_upi)}`,
                  view.paid_card > 0 && `Card ${fmt(view.paid_card)}`, view.credit_amount > 0 && `Credit ${fmt(view.credit_amount)}`]
                  .filter(Boolean).join(' · ')}
              </Text>
            </View>

            {can(user, 'billing.return') && ['completed', 'partial_return'].includes(view.status) && (
              <Btn title="↩ Return items" color={colors.orange} onPress={() => { setReturning(view); setView(null); }} />
            )}
            {can(user, 'billing.cancel') && ['completed', 'held'].includes(view.status) && (
              <Btn title="Cancel bill" color={colors.red} onPress={() => cancel(view)} />
            )}
            <Btn title="⬇ PDF" color={colors.green} onPress={() => openPdf(view.id)} />
            <Btn title="Close" color={colors.ink3} onPress={() => setView(null)} />
          </ScrollView>
        )}
      </Modal>

      <Modal visible={!!returning} animationType="slide" onRequestClose={() => setReturning(null)}>
        {returning && <ReturnForm sale={returning} onClose={() => setReturning(null)}
          onDone={() => { setReturning(null); load(); }} />}
      </Modal>
    </View>
  );
}

function ReturnForm({ sale, onClose, onDone }) {
  const [qty, setQtys] = useState({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const items = sale.items.filter(i => i.qty - i.returned_qty > 0);
  const refund = items.reduce((a, i) => a + (Number(qty[i.id]) || 0) * i.price, 0);

  const submit = async () => {
    const sel = items.filter(i => Number(qty[i.id]) > 0).map(i => ({ sale_item_id: i.id, qty: Number(qty[i.id]) }));
    if (!sel.length) return Alert.alert('Nothing to return', 'Enter quantities to return');
    setBusy(true);
    try {
      const d = await api(`/sales/${sale.id}/returns`, { method: 'POST', body: { items: sel, reason, refund_method: method } });
      Alert.alert('Return saved', `Refund ${fmt(d.refund_amount)}`);
      onDone();
    } catch (e) { Alert.alert('Error', e.message); }
    setBusy(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>Return items — {sale.invoice_no}</Text>
      {items.map(i => {
        const max = i.qty - i.returned_qty;
        return (
          <View key={i.id} style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }, shadow]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 13 }}>{i.medicine_name}</Text>
              <Text style={{ color: colors.ink3, fontSize: 12 }}>
                Sold {i.qty} · returned {i.returned_qty || 0} · {fmt(i.price)} each · max {max}
              </Text>
            </View>
            <TextInput keyboardType="numeric" placeholder="0" placeholderTextColor={colors.ink3}
              value={qty[i.id] === undefined ? '' : String(qty[i.id])}
              onChangeText={v => setQtys(q => ({ ...q, [i.id]: v === '' ? '' : Math.max(0, Math.min(Number(v.replace(/[^0-9]/g, '')) || 0, max)) }))}
              style={{ width: 64, backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.line, padding: 8, textAlign: 'right' }} />
          </View>
        );
      })}
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. wrong medicine, adverse reaction" />
      <Chips label="Refund method" value={method} onChange={setMethod} options={[
        { value: 'cash', label: 'Cash refund' }, { value: 'upi', label: 'UPI refund' },
        { value: 'credit_note', label: 'Credit note' },
      ]} />
      <Text style={{ fontWeight: '800', marginBottom: 8 }}>Refund: {fmt(refund)}</Text>
      <Btn title={busy ? 'Saving…' : 'Confirm Return'} color={colors.orange} onPress={submit} disabled={busy} />
      <Btn title="Close" color={colors.ink3} onPress={onClose} />
    </ScrollView>
  );
}
