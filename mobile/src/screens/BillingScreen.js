import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, Modal, ScrollView, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api, fmt, BASE_URL, getAuthToken } from '../api';
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
  const [cart, setCart] = useState([]); // {batch_id, medicine_id, name, batch_no, mrp, price, gst_rate, qty, stock, category, disc}
  const [phone, setPhone] = useState('');
  const [custName, setCustName] = useState(''); // walk-in name, plain field — no permission gate (mirrors web POS)
  const [custResults, setCustResults] = useState([]); // live customer suggestions
  const [customer, setCustomer] = useState(null); // selected profile (special discount)
  const [doctor, setDoctor] = useState('');
  const [rx, setRx] = useState(null); // prescription photo, base64 data URL
  const [capturingRx, setCapturingRx] = useState(false);
  const [split, setSplit] = useState(false);
  const [pay, setPay] = useState({ mode: 'cash', cash: '', upi: '', card: '', credit: '' });
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [discType, setDiscType] = useState('none'); // none | percent | amount | customer | promo
  const [discValue, setDiscValue] = useState('');
  const [promoId, setPromoId] = useState(null);
  const [promos, setPromos] = useState([]);
  const [held, setHeld] = useState([]);
  const [resumeId, setResumeId] = useState(null);
  const [approval, setApproval] = useState(null); // {message, email, password}
  const [newCust, setNewCust] = useState(null); // add-customer modal form
  const [done, setDone] = useState(null); // completed sale, shown in the bill-done modal
  const [permission, requestPermission] = useCameraPermissions();
  const debounce = useRef(null);
  const custDebounce = useRef(null);
  const camRef = useRef(null);

  const canManageCustomers = can(user, 'customers.manage');
  const canDiscount = can(user, 'billing.discount');
  const limit = user.discount_limit ?? 10;

  const loadHeld = () => api('/sales/held', { params: { branch_id: activeBranch } })
    .then(d => setHeld(d.sales)).catch(() => {});
  useEffect(() => { if (activeBranch) loadHeld(); }, [activeBranch]);

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
    setCustomer(c); setPhone(c.phone); setCustName(c.name || ''); setCustResults([]);
  };
  const clearCustomer = () => {
    setCustomer(null); setPhone(''); setCustName('');
    if (discType === 'customer') setDiscType('none');
  };

  // Open the add-customer form, prefilling whatever is already typed
  const openNewCustomer = () => {
    setNewCust({
      name: custName.trim(), phone: phone.trim(),
      address: '', customer_type: 'individual', gstin: '', discount_percent: '',
    });
    setCustResults([]);
  };
  const saveNewCustomer = async () => {
    const f = newCust;
    if (!f.name.trim() || !f.phone.trim()) return Alert.alert('Missing details', 'Name and mobile number are required.');
    setBusy(true);
    try {
      const { id } = await api('/customers', { method: 'POST', body: {
        name: f.name.trim(), phone: f.phone.trim(), address: f.address,
        customer_type: f.customer_type, gstin: f.gstin,
        discount_percent: Number(f.discount_percent) || 0, branch_id: activeBranch,
      } });
      // Select the freshly created customer for this bill
      setCustomer({ id, name: f.name.trim(), phone: f.phone.trim(),
        discount_percent: Number(f.discount_percent) || 0, loyalty_points: 0, total_bills: 0 });
      setPhone(f.phone.trim()); setNewCust(null);
      Alert.alert('Customer added ✓', `${f.name.trim()} is now attached to this bill.`);
    } catch (e) { Alert.alert('Could not add customer', e.message); }
    setBusy(false);
  };

  const add = r => {
    setCart(c => {
      const ex = c.find(i => i.batch_id === r.batch_id);
      if (ex) {
        if (ex.qty + 1 > r.qty) { Alert.alert('Out of stock', `Only ${r.qty} in stock for ${r.name}`); return c; }
        return c.map(i => i.batch_id === r.batch_id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...c, {
        batch_id: r.batch_id, medicine_id: r.id, name: r.name, price: r.selling_price, mrp: r.mrp,
        qty: 1, stock: r.qty, batch_no: r.batch_no, expiry: r.expiry_date, category: r.category, gst_rate: r.gst_rate,
        rx: r.prescription_required, disc: '',
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

  const ensureCameraPermission = async () => {
    if (permission?.granted) return true;
    const r = await requestPermission();
    if (!r.granted) { Alert.alert('Camera permission needed'); return false; }
    return true;
  };
  const startScan = async () => { if (await ensureCameraPermission()) setScanning(true); };
  const startRxCapture = async () => { if (await ensureCameraPermission()) setCapturingRx(true); };
  const takeRxPhoto = async () => {
    try {
      const photo = await camRef.current?.takePictureAsync({ base64: true, quality: 0.4 });
      if (photo?.base64) {
        // base64 chars ≈ 4/3 of raw bytes — same ~1.4MB cap as web POS.jsx onRx
        if (photo.base64.length * 0.75 > 1_400_000) {
          Alert.alert('Photo too large', 'Prescription photo is too large (max 1.4MB). Try again with a tighter shot.');
        } else {
          setRx(`data:image/jpeg;base64,${photo.base64}`);
        }
      }
    } catch (e) { Alert.alert('Could not capture photo', e.message); }
    setCapturingRx(false);
  };

  const setQty = (batchId, qty) => setCart(c => c.map(i => {
    if (i.batch_id !== batchId) return i;
    const n = Math.max(1, Math.min(Number(qty) || 1, i.stock));
    return { ...i, qty: n };
  }));
  const setLineDisc = (batchId, v) => setCart(c => c.map(i => i.batch_id === batchId ? { ...i, disc: v } : i));

  // ---- Totals (mirrors web POS: item-wise discount, then bill-level, then GST) ----
  const grossAmount = cart.reduce((a, i) => a + i.qty * i.price, 0);
  const itemDisc = cart.reduce((a, i) => a + Math.min(Number(i.disc) || 0, i.qty * i.price), 0);
  const subtotal = grossAmount - itemDisc;
  const selectedPromo = promos.find(p => p.id === promoId);
  let billDisc = 0;
  if (discType === 'percent') billDisc = Math.min(subtotal * (Number(discValue) || 0) / 100, subtotal);
  else if (discType === 'amount') billDisc = Math.min(Number(discValue) || 0, subtotal);
  else if (discType === 'customer') billDisc = Math.min(subtotal * (Number(customer?.discount_percent) || 0) / 100, subtotal);
  else if (discType === 'promo' && selectedPromo) {
    const p = selectedPromo;
    const base = p.applies_to === 'all' ? subtotal
      : cart.reduce((a, i) => {
        const lineNet = i.qty * i.price - Math.min(Number(i.disc) || 0, i.qty * i.price);
        const match = p.applies_to === 'category' ? i.category === p.category : i.medicine_id === p.medicine_id;
        return a + (match ? lineNet : 0);
      }, 0);
    if (subtotal >= (p.min_bill_amount || 0) && base > 0) {
      billDisc = p.discount_type === 'percent' ? base * p.discount_value / 100 : Math.min(p.discount_value, base);
    }
  }
  const totalDiscount = itemDisc + billDisc;
  const manualDiscount = itemDisc + (['percent', 'amount'].includes(discType) ? billDisc : 0);
  const discountPct = grossAmount > 0 ? (manualDiscount / grossAmount) * 100 : 0;
  const overLimit = manualDiscount > 0 && discountPct > limit + 0.01;
  const gstBase = cart.reduce((a, i) => {
    const lineNet = i.qty * i.price - Math.min(Number(i.disc) || 0, i.qty * i.price);
    return a + (lineNet * i.gst_rate) / (100 + i.gst_rate);
  }, 0);
  const gst = subtotal > 0 ? gstBase * (subtotal - billDisc) / subtotal : 0;
  const taxable = subtotal - billDisc - gst;
  const total = Math.round(subtotal - billDisc);
  const roundOff = total - (subtotal - billDisc);

  useEffect(() => {
    if (!split) setPay(p => ({ ...p, cash: '', upi: '', card: '', credit: '', [p.mode]: total || '' }));
  }, [total, split]);
  const paySum = ['cash', 'upi', 'card', 'credit'].reduce((a, k) => a + (Number(pay[k]) || 0), 0);

  const discLabel = discType === 'none' ? 'No discount'
    : discType === 'percent' ? `${discValue || 0}% off`
    : discType === 'amount' ? `₹${discValue || 0} off`
    : discType === 'customer' ? `Customer ${customer?.discount_percent || 0}%`
    : selectedPromo ? `Offer: ${selectedPromo.name}` : 'Offer';

  const resetForm = () => {
    setCart([]); setPhone(''); setCustName(''); setCustomer(null); setDoctor(''); setRx(null);
    setDiscType('none'); setDiscValue(''); setPromoId(null); setApproval(null);
    setPay({ mode: 'cash', cash: '', upi: '', card: '', credit: '' }); setSplit(false);
    setResumeId(null);
  };

  const submit = async (hold = false, approvalCreds = null) => {
    if (!cart.length) return Alert.alert('Cart is empty');
    if (!hold && Math.abs(paySum - total) > 0.01) return Alert.alert('Payment mismatch', `Payment ₹${paySum} must equal total ₹${total}`);
    setBusy(true);
    try {
      const d = await api('/sales', {
        method: 'POST',
        body: {
          branch_id: activeBranch || undefined,
          items: cart.map(i => ({ batch_id: i.batch_id, qty: i.qty, discount: Number(i.disc) || 0 })),
          customer_id: customer?.id || undefined,
          customer_phone: phone.trim() || undefined,
          customer_name: custName.trim() || undefined,
          discount: { type: (discType === 'promo' && !promoId) ? 'none' : (totalDiscount > 0 || discType !== 'none' ? discType : 'none'), value: Number(discValue) || 0, promo_id: promoId },
          doctor_name: doctor,
          payment: { cash: Number(pay.cash) || 0, upi: Number(pay.upi) || 0, card: Number(pay.card) || 0, credit: Number(pay.credit) || 0 },
          hold, prescription_file: rx || undefined,
          resume_sale_id: resumeId || undefined,
          approval: approvalCreds || undefined,
        },
      });
      if (hold) {
        Alert.alert('Bill held', `${d.invoice_no} — resume it anytime from the held bills list.`);
      } else {
        setDone(d.sale);
      }
      resetForm();
      loadHeld();
    } catch (e) {
      if (e.approval_required) setApproval({ message: e.message, email: '', password: '' });
      else Alert.alert('Could not save bill', e.message);
    }
    setBusy(false);
  };

  const resumeHeld = (s) => {
    setCart(s.items.map(i => ({
      batch_id: i.batch_id, medicine_id: i.medicine_id, name: i.medicine_name, batch_no: i.batch_no,
      mrp: i.mrp, price: i.price, gst_rate: i.gst_rate, qty: i.qty, stock: 9999, disc: i.discount || '',
    })));
    setPhone(s.customer_phone || ''); setDoctor(s.doctor_name || '');
    if (s.discount > 0) { setDiscType('amount'); setDiscValue(s.discount); }
    setResumeId(s.id);
    Alert.alert('Resumed', `Held bill ${s.invoice_no} loaded into the cart.`);
  };

  const totalRow = (label, value, big) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: big ? 0 : 2 }}>
      <Text style={{ color: '#fff', fontWeight: big ? '800' : '600', fontSize: big ? 15 : 13, opacity: big ? 1 : 0.9 }}>{label}</Text>
      <Text style={{ color: '#fff', fontWeight: big ? '800' : '600', fontSize: big ? 22 : 13 }}>{value}</Text>
    </View>
  );

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
                <Text style={{ fontWeight: '700' }}>
                  {r.name} <Text style={{ color: colors.green }}>{fmt(r.selling_price)}</Text>
                  {!!r.prescription_required && <Text style={{ color: colors.orange, fontSize: 11 }}>  Rx</Text>}
                </Text>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>Batch {r.batch_no} · {r.qty} in stock · Rack {r.rack_location}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {held.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, maxHeight: 40 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {held.map(s => (
              <TouchableOpacity key={s.id} onPress={() => resumeHeld(s)}
                style={{ backgroundColor: colors.orangeLight, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12 }}>
                <Text style={{ color: colors.orange, fontWeight: '700', fontSize: 12 }}>
                  ⏸ {s.invoice_no} · {fmt(s.total)}{s.customer_name ? ` · ${s.customer_name}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      <FlatList
        style={{ marginTop: 10 }}
        data={cart}
        keyExtractor={i => String(i.batch_id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>Cart is empty — search or scan to add items</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700' }}>{item.name}{!!item.rx && <Text style={{ color: colors.orange, fontSize: 11 }}>  Rx</Text>}</Text>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>{item.batch_no} · Exp {item.expiry} · MRP {fmt(item.mrp)} · {fmt(item.price)}</Text>
              </View>
              <TouchableOpacity onPress={() => setCart(c => c.map(i => i.batch_id === item.batch_id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))}>
                <Text style={{ fontSize: 20, paddingHorizontal: 10 }}>−</Text>
              </TouchableOpacity>
              <TextInput keyboardType="numeric" value={String(item.qty)}
                onChangeText={v => setQty(item.batch_id, v)}
                style={{ minWidth: 30, textAlign: 'center', fontWeight: '700', borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 2 }} />
              <TouchableOpacity onPress={() => setCart(c => c.map(i => i.batch_id === item.batch_id ? { ...i, qty: Math.min(i.stock, i.qty + 1) } : i))}>
                <Text style={{ fontSize: 20, paddingHorizontal: 10 }}>＋</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCart(c => c.filter(i => i.batch_id !== item.batch_id))}>
                <Text style={{ color: colors.red, paddingLeft: 6 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              {canDiscount ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: colors.ink3, fontSize: 12, marginRight: 6 }}>Disc ₹</Text>
                  <TextInput keyboardType="numeric" placeholder="0" value={String(item.disc || '')}
                    onChangeText={v => setLineDisc(item.batch_id, v)}
                    style={{ width: 56, textAlign: 'right', borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6, fontSize: 12 }} />
                </View>
              ) : <View />}
              <Text style={{ fontWeight: '700' }}>
                {fmt(item.qty * item.price - Math.min(Number(item.disc) || 0, item.qty * item.price))}
              </Text>
            </View>
          </View>
        )}
      />

      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 12 }, shadow]}>
        <TextInput style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 6 }}
          placeholder="Customer mobile number (optional)" value={phone} keyboardType="phone-pad"
          onChangeText={v => { setPhone(v); if (customer) setCustomer(null); }} />
        <TextInput style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 6 }}
          placeholder="Customer name (optional)" value={custName}
          onChangeText={v => { setCustName(v); if (customer) setCustomer(null); }} />
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
        {customer ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ color: colors.green, fontSize: 12, flex: 1 }}>
              ✓ {customer.name}{Number(customer.discount_percent) > 0 ? ` · special discount ${customer.discount_percent}%` : ''} · {Math.round(customer.loyalty_points || 0)} pts
            </Text>
            <TouchableOpacity onPress={clearCustomer}><Text style={{ color: colors.red, fontSize: 12 }}>✕ change</Text></TouchableOpacity>
          </View>
        ) : canManageCustomers && (
          <TouchableOpacity onPress={openNewCustomer} style={{ marginBottom: 8 }}>
            <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 13 }}>＋ Add new customer</Text>
          </TouchableOpacity>
        )}

        <TextInput style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 6 }}
          placeholder="Doctor name (optional)" value={doctor} onChangeText={setDoctor} />

        {rx ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: colors.green, fontSize: 12, flex: 1 }}>📎 Prescription attached ✓</Text>
            <TouchableOpacity onPress={() => setRx(null)}><Text style={{ color: colors.red, fontSize: 12 }}>remove</Text></TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={startRxCapture} style={{ marginBottom: 8 }}>
            <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 13 }}>📎 Attach prescription photo</Text>
          </TouchableOpacity>
        )}

        {canDiscount ? (
          <TouchableOpacity onPress={() => setDiscOpen(true)}
            style={{ borderWidth: 1, borderColor: billDisc > 0 ? colors.green : colors.line, borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: billDisc > 0 ? colors.greenLight : '#fff' }}>
            <Text style={{ fontWeight: '700', color: billDisc > 0 ? colors.green : colors.ink2 }}>
              💸 {discLabel}{billDisc > 0 ? ` · saves ${fmt(billDisc)}` : ' — tap to add bill discount'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 8, opacity: 0.6 }}>
            <Text style={{ fontWeight: '700', color: colors.ink3 }}>💸 Discount (not permitted)</Text>
          </View>
        )}
        {itemDisc > 0 && (
          <Text style={{ color: colors.ink3, fontSize: 12, marginBottom: 4 }}>Item-wise discounts: {fmt(itemDisc)}</Text>
        )}
        {(billDisc > 0 || itemDisc > 0) && overLimit && (
          <Text style={{ color: colors.orange, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
            {discountPct.toFixed(1)}% exceeds your {limit}% limit — manager approval will be asked
          </Text>
        )}

        {/* Totals breakdown, mirrors the web POS gradient total box */}
        <View style={{ backgroundColor: colors.brandDark, borderRadius: 10, padding: 14, marginBottom: 10 }}>
          {totalRow('Gross Amount', fmt(grossAmount))}
          {itemDisc > 0 && totalRow('Item Discounts', `− ${fmt(itemDisc)}`)}
          {billDisc > 0 && totalRow(
            discType === 'promo' && selectedPromo ? `Offer: ${selectedPromo.name}`
              : discType === 'customer' ? `Customer Discount (${customer?.discount_percent}%)` : 'Discount',
            `− ${fmt(billDisc)}`)}
          {totalRow('Taxable Amount', fmt(taxable))}
          {totalRow('GST (incl.)', fmt(gst))}
          {totalRow('Round off', roundOff.toFixed(2))}
          <View style={{ borderTopWidth: 1, borderColor: 'rgba(255,255,255,.3)', marginVertical: 8 }} />
          {totalRow('NET PAYABLE', fmt(total), true)}
          {totalDiscount > 0 && (
            <Text style={{ color: '#ffd9a8', textAlign: 'center', marginTop: 6, fontSize: 12 }}>
              🎉 Customer saves {fmt(totalDiscount)} ({(grossAmount > 0 ? totalDiscount / grossAmount * 100 : 0).toFixed(1)}%)
            </Text>
          )}
        </View>

        {!split ? (
          <>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
              {['cash', 'upi', 'card', 'credit'].map(m => (
                <TouchableOpacity key={m} onPress={() => setPay({ mode: m, cash: '', upi: '', card: '', credit: '', [m]: total || '' })}
                  style={{ flex: 1, padding: 8, borderRadius: 8, backgroundColor: pay.mode === m ? colors.brand : colors.brandLight }}>
                  <Text style={{ textAlign: 'center', color: pay.mode === m ? '#fff' : colors.brand, fontWeight: '700' }}>{m.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {pay.mode === 'credit' && !phone && (
              <Text style={{ color: colors.red, fontSize: 12, marginBottom: 6 }}>Credit sale needs a customer mobile number</Text>
            )}
            <TouchableOpacity onPress={() => setSplit(true)} style={{ marginBottom: 10 }}>
              <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '700' }}>Split payment across methods →</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
              {['cash', 'upi', 'card', 'credit'].map(m => (
                <View key={m} style={{ width: '48%' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.ink2, marginBottom: 2 }}>{m.toUpperCase()}</Text>
                  <TextInput keyboardType="numeric" value={String(pay[m])} onChangeText={v => setPay(p => ({ ...p, [m]: v }))}
                    style={{ backgroundColor: '#fff', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: colors.line }} />
                </View>
              ))}
            </View>
            <Text style={{ color: Math.abs(paySum - total) > 0.01 ? colors.red : colors.green, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
              Entered {fmt(paySum)} of {fmt(total)}
            </Text>
            <TouchableOpacity onPress={() => setSplit(false)} style={{ marginBottom: 10 }}>
              <Text style={{ color: colors.brand, fontSize: 12, fontWeight: '700' }}>← Single payment method</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => submit(false)} disabled={busy || !cart.length}
            style={{ flex: 1, backgroundColor: colors.green, borderRadius: 10, padding: 14, opacity: cart.length ? 1 : 0.5 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800', fontSize: 15 }}>💾 Save & Print — {fmt(total)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => submit(true)} disabled={busy || !cart.length}
            style={{ backgroundColor: colors.orange, borderRadius: 10, padding: 14, paddingHorizontal: 18, opacity: cart.length ? 1 : 0.5 }}>
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800' }}>⏸ Hold</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Discount picker */}
      <Modal visible={discOpen} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '80%' }}>
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 10 }}>💸 Bill discount (your limit {limit}%)</Text>
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
              {discType === 'promo' && selectedPromo && subtotal < (selectedPromo.min_bill_amount || 0) && (
                <Text style={{ color: colors.red, fontSize: 12, marginBottom: 8 }}>Bill must be at least ₹{selectedPromo.min_bill_amount} for this offer</Text>
              )}
              <Text style={{ color: colors.ink2, marginBottom: 10 }}>
                Subtotal {fmt(subtotal)} − {fmt(billDisc)} = <Text style={{ fontWeight: '800' }}>{fmt(total)}</Text>
              </Text>
              <Btn title="Apply Discount" color={colors.green} onPress={() => setDiscOpen(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add new customer from within billing */}
      <Modal visible={!!newCust} animationType="slide" onRequestClose={() => setNewCust(null)}>
        {newCust && (
          <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>New customer</Text>
            <Field label="Full name *" value={newCust.name} onChangeText={v => setNewCust(c => ({ ...c, name: v }))} />
            <Field label="Mobile number *" keyboardType="phone-pad" value={newCust.phone} onChangeText={v => setNewCust(c => ({ ...c, phone: v }))} />
            <Field label="Address" value={newCust.address} onChangeText={v => setNewCust(c => ({ ...c, address: v }))} />
            <Chips label="Customer type" value={newCust.customer_type} onChange={v => setNewCust(c => ({ ...c, customer_type: v }))}
              options={[{ value: 'individual', label: 'Individual' }, { value: 'business', label: 'Business (GST)' }]} />
            {newCust.customer_type === 'business' && (
              <Field label="GST number (GSTIN)" autoCapitalize="characters" value={newCust.gstin} onChangeText={v => setNewCust(c => ({ ...c, gstin: v }))} />
            )}
            <Field label="Special discount % (optional)" keyboardType="numeric" value={String(newCust.discount_percent)} onChangeText={v => setNewCust(c => ({ ...c, discount_percent: v }))} />
            <Btn title={busy ? 'Saving…' : '💾 Save & attach to bill'} color={colors.green} disabled={busy} onPress={saveNewCustomer} />
            <Btn title="Cancel" color={colors.ink3} onPress={() => setNewCust(null)} />
          </ScrollView>
        )}
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
              onPress={() => submit(false, { email: approval.email, password: approval.password })} />
            <Btn title="Cancel" color={colors.ink3} onPress={() => setApproval(null)} />
          </View>
        </View>
      </Modal>

      {/* Barcode scanner */}
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

      {/* Prescription photo capture */}
      <Modal visible={capturingRx} animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={camRef} style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => setCapturingRx(false)} style={{ flex: 1, backgroundColor: colors.red, padding: 16 }}>
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={takeRxPhoto} style={{ flex: 1, backgroundColor: colors.green, padding: 16 }}>
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>📸 Capture Prescription</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Bill saved — items summary, WhatsApp share, print/PDF */}
      <BillDoneModal sale={done} onClose={() => setDone(null)} />
    </View>
  );
}

function BillDoneModal({ sale, onClose }) {
  if (!sale) return null;
  const saved = (sale.discount || 0) + (sale.item_discount || 0);
  const pdfUrl = `${BASE_URL}/api/sales/${sale.id}/pdf?token=${getAuthToken()}`;
  const wa = async () => {
    try {
      const d = await api(`/sales/${sale.id}/whatsapp`);
      Linking.openURL(d.url);
    } catch (e) { Alert.alert('Could not share', e.message); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.5)', justifyContent: 'center', padding: 16 }}>
        <View style={[{ backgroundColor: '#fff', borderRadius: 14, padding: 18, maxHeight: '85%' }, shadow]}>
          <Text style={{ textAlign: 'center', fontSize: 36 }}>✅</Text>
          <Text style={{ textAlign: 'center', fontWeight: '800', fontSize: 12, color: colors.ink3, marginTop: 4 }}>{sale.invoice_no}</Text>
          <Text style={{ textAlign: 'center', fontWeight: '800', fontSize: 26, marginBottom: 2 }}>{fmt(sale.total)}</Text>
          <Text style={{ textAlign: 'center', marginBottom: 6 }}>
            <Text style={{ backgroundColor: colors.brandLight, color: colors.brand, fontWeight: '700', fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, overflow: 'hidden' }}>
              {sale.status}
            </Text>
          </Text>
          {saved > 0 && (
            <Text style={{ textAlign: 'center', color: colors.orange, fontWeight: '700', marginBottom: 6 }}>
              🎉 You saved {fmt(saved)} on this purchase!
              {sale.discount_approved_by_name ? ` (approved by ${sale.discount_approved_by_name})` : ''}
            </Text>
          )}
          <Text style={{ textAlign: 'center', color: colors.ink3, marginBottom: 10 }}>
            {sale.customer_name ? `${sale.customer_name} (${sale.customer_phone})` : 'Walk-in customer'}
          </Text>
          <ScrollView style={{ maxHeight: 200, borderTopWidth: 1, borderColor: colors.line }}>
            {(sale.items || []).map(i => (
              <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.line }}>
                <Text style={{ flex: 1 }}>{i.medicine_name}</Text>
                <Text style={{ width: 40, textAlign: 'center', color: colors.ink3 }}>x{i.qty}</Text>
                <Text style={{ fontWeight: '700' }}>{fmt(i.total)}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <TouchableOpacity onPress={wa} style={{ flex: 1, backgroundColor: colors.orange, borderRadius: 10, padding: 12 }}>
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>📱 WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL(pdfUrl)} style={{ flex: 1, backgroundColor: colors.green, borderRadius: 10, padding: 12 }}>
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>⬇ PDF Bill</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL(pdfUrl)} style={{ flex: 1, backgroundColor: colors.brand, borderRadius: 10, padding: 12 }}>
              <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>🖨 Print Receipt</Text>
            </TouchableOpacity>
          </View>
          <Btn title="New Bill" color={colors.ink3} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
