import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, Modal, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api, fmt } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { colors, shadow } from '../theme';
import { Field, Chips, Btn, BranchBar } from '../ui';

export default function BillingScreen() {
  const { user } = useAuth();
  const { branchId, options } = useBranch();
  // Billing always needs ONE concrete branch — owners on "All Branches"
  // fall back to the first branch (matches the highlighted chip).
  const activeBranch = Number(branchId) || options[0]?.id || user.branch_id;
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [phone, setPhone] = useState('');
  const [custResults, setCustResults] = useState([]); // live customer suggestions
  const [customer, setCustomer] = useState(null); // selected profile (special discount)
  const [payMode, setPayMode] = useState('cash');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [discType, setDiscType] = useState('none'); // none | percent | amount | customer | promo
  const [discValue, setDiscValue] = useState('');
  const [promoId, setPromoId] = useState(null);
  const [promos, setPromos] = useState([]);
  const [approval, setApproval] = useState(null); // {message, email, password}
  const [permission, requestPermission] = useCameraPermissions();
  const debounce = useRef(null);
  const custDebounce = useRef(null);

  const canDiscount = can(user, 'billing.discount');
  const limit = user.discount_limit ?? 10;

  useEffect(() => {
    api('/promotions/active', { params: { branch_id: activeBranch } })
      .then(d => setPromos(d.promotions)).catch(() => {});
  }, [activeBranch]);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); return; }
    debounce.current = setTimeout(() => {
      api('/inventory/medicines/pos-search', { params: { q: q.trim(), branch_id: activeBranch } })
        .then(d => setResults(d.results)).catch(() => {});
    }, 200);
  }, [q, activeBranch]);

  // Live customer search by mobile number OR name — suggestions to tap
  useEffect(() => {
    clearTimeout(custDebounce.current);
    const term = phone.trim();
    if (customer || term.length < 2) { setCustResults([]); return; }
    custDebounce.current = setTimeout(() => {
      api('/customers', { params: { q: term, limit: 5 } })
        .then(d => setCustResults(d.customers.slice(0, 5)))
        .catch(() => {});
    }, 250);
  }, [phone, customer]);

  const pickCustomer = c => {
    setCustomer(c); setPhone(c.phone); setCustResults([]);
  };
  const clearCustomer = () => {
    setCustomer(null); setPhone('');
    if (discType === 'customer') setDiscType('none');
  };

  const add = r => {
    setCart(c => {
      const ex = c.find(i => i.batch_id === r.batch_id);
      if (ex) return c.map(i => i.batch_id === r.batch_id ? { ...i, qty: Math.min(i.qty + 1, r.qty) } : i);
      return [...c, {
        batch_id: r.batch_id, medicine_id: r.id, name: r.name, price: r.selling_price,
        qty: 1, stock: r.qty, batch_no: r.batch_no, category: r.category, gst_rate: r.gst_rate,
      }];
    });
    setQ(''); setResults([]);
  };

  const onScan = ({ data }) => {
    if (!scanning) return;
    setScanning(false);
    api('/inventory/medicines/pos-search', { params: { q: data, branch_id: activeBranch } })
      .then(d => d.results.length ? add(d.results[0]) : Alert.alert('Not found', `No in-stock medicine for barcode ${data}`))
      .catch(e => Alert.alert('Error', e.message));
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) return Alert.alert('Camera permission needed to scan barcodes');
    }
    setScanning(true);
  };

  // ---- Totals with discount ----
  const gross = cart.reduce((a, i) => a + i.qty * i.price, 0);
  const selectedPromo = promos.find(p => p.id === promoId);
  let billDisc = 0;
  if (discType === 'percent') billDisc = Math.min(gross * (Number(discValue) || 0) / 100, gross);
  else if (discType === 'amount') billDisc = Math.min(Number(discValue) || 0, gross);
  else if (discType === 'customer') billDisc = gross * (Number(customer?.discount_percent) || 0) / 100;
  else if (discType === 'promo' && selectedPromo) {
    const p = selectedPromo;
    const base = p.applies_to === 'all' ? gross
      : cart.reduce((a, i) => a + ((p.applies_to === 'category' ? i.category === p.category : i.medicine_id === p.medicine_id) ? i.qty * i.price : 0), 0);
    if (gross >= (p.min_bill_amount || 0) && base > 0) {
      billDisc = p.discount_type === 'percent' ? base * p.discount_value / 100 : Math.min(p.discount_value, base);
    }
  }
  const total = Math.round(gross - billDisc);
  const discountPct = gross > 0 ? (billDisc / gross) * 100 : 0;
  // Offers/customer discounts are admin-configured — only manual %/₹ counts against the user limit
  const overLimit = ['percent', 'amount'].includes(discType) && discountPct > limit + 0.01;

  const discLabel = discType === 'none' ? 'No discount'
    : discType === 'percent' ? `${discValue || 0}% off`
    : discType === 'amount' ? `₹${discValue || 0} off`
    : discType === 'customer' ? `Customer ${customer?.discount_percent || 0}%`
    : selectedPromo ? `Offer: ${selectedPromo.name}` : 'Offer';

  const save = async (approvalCreds = null) => {
    if (!cart.length) return;
    setBusy(true);
    try {
      const d = await api('/sales', {
        method: 'POST',
        body: {
          branch_id: activeBranch || undefined,
          items: cart.map(i => ({ batch_id: i.batch_id, qty: i.qty })),
          customer_id: customer?.id || undefined,
          customer_phone: phone || undefined,
          discount: { type: billDisc > 0 ? discType : 'none', value: Number(discValue) || 0, promo_id: promoId },
          payment: { cash: 0, upi: 0, card: 0, credit: 0, [payMode]: total },
          approval: approvalCreds || undefined,
        },
      });
      const saved = (d.sale?.discount || 0) + (d.sale?.item_discount || 0);
      Alert.alert('Bill saved ✓', `${d.invoice_no}\nTotal ${fmt(d.total)}${saved > 0 ? `\nCustomer saved ${fmt(saved)} 🎉` : ''}`);
      setCart([]); setPhone(''); setCustomer(null);
      setDiscType('none'); setDiscValue(''); setPromoId(null); setApproval(null);
    } catch (e) {
      if (e.approval_required) setApproval({ message: e.message, email: '', password: '' });
      else Alert.alert('Could not save bill', e.message);
    }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar requireBranch />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.line }}
          placeholder="Search medicine / batch…" value={q} onChangeText={setQ} />
        <TouchableOpacity onPress={startScan} style={{ backgroundColor: colors.brand, borderRadius: 10, padding: 12, justifyContent: 'center' }}>
          <Text style={{ color: '#fff' }}>📷 Scan</Text>
        </TouchableOpacity>
      </View>

      {results.length > 0 && (
        <View style={[{ backgroundColor: '#fff', borderRadius: 10, marginTop: 6, maxHeight: 220 }, shadow]}>
          <ScrollView>
            {results.map(r => (
              <TouchableOpacity key={r.batch_id} onPress={() => add(r)} style={{ padding: 12, borderBottomWidth: 1, borderColor: colors.line }}>
                <Text style={{ fontWeight: '700' }}>{r.name} <Text style={{ color: colors.green }}>{fmt(r.selling_price)}</Text></Text>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>Batch {r.batch_no} · {r.qty} in stock · Rack {r.rack_location}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <FlatList
        style={{ marginTop: 10 }}
        data={cart}
        keyExtractor={i => String(i.batch_id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>Cart is empty — search or scan to add items</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }, shadow]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }}>{item.name}</Text>
              <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.batch_no} · {fmt(item.price)}</Text>
            </View>
            <TouchableOpacity onPress={() => setCart(c => c.map(i => i.batch_id === item.batch_id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))}>
              <Text style={{ fontSize: 20, paddingHorizontal: 10 }}>−</Text>
            </TouchableOpacity>
            <Text style={{ fontWeight: '700', minWidth: 24, textAlign: 'center' }}>{item.qty}</Text>
            <TouchableOpacity onPress={() => setCart(c => c.map(i => i.batch_id === item.batch_id ? { ...i, qty: Math.min(i.stock, i.qty + 1) } : i))}>
              <Text style={{ fontSize: 20, paddingHorizontal: 10 }}>＋</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCart(c => c.filter(i => i.batch_id !== item.batch_id))}>
              <Text style={{ color: colors.red, paddingLeft: 6 }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 12 }, shadow]}>
        <TextInput style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 6 }}
          placeholder="Customer mobile or name (optional)" value={phone}
          onChangeText={v => { setPhone(v); if (customer) setCustomer(null); }} />
        {custResults.length > 0 && (
          <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, marginBottom: 6, maxHeight: 160 }}>
            <ScrollView>
              {custResults.map(c => (
                <TouchableOpacity key={c.id} onPress={() => pickCustomer(c)}
                  style={{ padding: 10, borderBottomWidth: 1, borderColor: colors.line }}>
                  <Text style={{ fontWeight: '700' }}>
                    {c.name}
                    {Number(c.discount_percent) > 0 && <Text style={{ color: colors.green, fontSize: 11 }}>  {c.discount_percent}% disc</Text>}
                  </Text>
                  <Text style={{ color: colors.ink3, fontSize: 12 }}>{c.phone} · {c.total_bills} bills · {Math.round(c.loyalty_points)} ⭐</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        {customer && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ color: colors.green, fontSize: 12, flex: 1 }}>
              ✓ {customer.name}{Number(customer.discount_percent) > 0 ? ` · special discount ${customer.discount_percent}%` : ''}
            </Text>
            <TouchableOpacity onPress={clearCustomer}><Text style={{ color: colors.red, fontSize: 12 }}>✕ change</Text></TouchableOpacity>
          </View>
        )}
        {canDiscount && (
          <TouchableOpacity onPress={() => setDiscOpen(true)}
            style={{ borderWidth: 1, borderColor: billDisc > 0 ? colors.green : colors.line, borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: billDisc > 0 ? colors.greenLight : '#fff' }}>
            <Text style={{ fontWeight: '700', color: billDisc > 0 ? colors.green : colors.ink2 }}>
              💸 {discLabel}{billDisc > 0 ? ` · saves ${fmt(billDisc)}` : ' — tap to add discount'}
            </Text>
          </TouchableOpacity>
        )}
        {billDisc > 0 && (
          <View style={{ marginBottom: 6 }}>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>Gross {fmt(gross)} − Discount {fmt(billDisc)} ({discountPct.toFixed(1)}%)</Text>
            {overLimit && (
              <Text style={{ color: colors.orange, fontSize: 12, fontWeight: '700' }}>Above your {limit}% limit — manager approval will be asked</Text>
            )}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
          {['cash', 'upi', 'card'].map(m => (
            <TouchableOpacity key={m} onPress={() => setPayMode(m)}
              style={{ flex: 1, padding: 8, borderRadius: 8, backgroundColor: payMode === m ? colors.brand : colors.brandLight }}>
              <Text style={{ textAlign: 'center', color: payMode === m ? '#fff' : colors.brand, fontWeight: '700' }}>{m.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => save()} disabled={busy || !cart.length}
          style={{ backgroundColor: colors.green, borderRadius: 10, padding: 14, opacity: cart.length ? 1 : 0.5 }}>
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800', fontSize: 16 }}>
            💾 Save Bill — {fmt(total)}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Discount picker */}
      <Modal visible={discOpen} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 10 }}>💸 Discount (your limit {limit}%)</Text>
            <ScrollView>
              <Chips value={discType} onChange={t => { setDiscType(t); if (t === 'none') { setDiscValue(''); setPromoId(null); } }}
                options={[
                  { value: 'none', label: 'No Discount' },
                  { value: 'percent', label: 'Percentage %' },
                  { value: 'amount', label: 'Fixed ₹' },
                  ...(customer && Number(customer.discount_percent) > 0 ? [{ value: 'customer', label: `Customer ${customer.discount_percent}%` }] : []),
                  ...(promos.length ? [{ value: 'promo', label: '🏷️ Offer' }] : []),
                ]} />
              {(discType === 'percent' || discType === 'amount') && (
                <Field label={discType === 'percent' ? 'Discount %' : 'Discount amount ₹'} keyboardType="numeric"
                  value={String(discValue)} onChangeText={setDiscValue} />
              )}
              {discType === 'promo' && (
                <Chips label="Choose offer" value={promoId} onChange={setPromoId}
                  options={promos.map(p => ({
                    value: p.id,
                    label: `${p.name} (${p.discount_type === 'percent' ? p.discount_value + '%' : '₹' + p.discount_value}${p.min_bill_amount > 0 ? `, min ₹${p.min_bill_amount}` : ''})`,
                  }))} />
              )}
              <Text style={{ color: colors.ink2, marginBottom: 10 }}>
                Gross {fmt(gross)} − {fmt(billDisc)} = <Text style={{ fontWeight: '800' }}>{fmt(total)}</Text>
              </Text>
              <Btn title="Apply Discount" color={colors.green} onPress={() => setDiscOpen(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Manager approval when over the limit */}
      <Modal visible={!!approval} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.5)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 6 }}>Manager approval required</Text>
            <Text style={{ color: colors.red, marginBottom: 10 }}>{approval?.message}</Text>
            <Field label="Manager email" autoCapitalize="none" keyboardType="email-address"
              value={approval?.email || ''} onChangeText={v => setApproval(a => ({ ...a, email: v }))} />
            <Field label="Manager password" secureTextEntry
              value={approval?.password || ''} onChangeText={v => setApproval(a => ({ ...a, password: v }))} />
            <Btn title={busy ? 'Saving…' : '✓ Approve & Save Bill'} color={colors.green} disabled={busy || !approval?.email || !approval?.password}
              onPress={() => save({ email: approval.email, password: approval.password })} />
            <Btn title="Cancel" color={colors.ink3} onPress={() => setApproval(null)} />
          </View>
        </View>
      </Modal>

      <Modal visible={scanning} animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            onBarcodeScanned={onScan}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
          />
          <TouchableOpacity onPress={() => setScanning(false)} style={{ backgroundColor: colors.red, padding: 16 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}
