import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, Modal, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api, fmt } from '../api';
import { colors, shadow } from '../theme';

export default function BillingScreen() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [phone, setPhone] = useState('');
  const [payMode, setPayMode] = useState('cash');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const debounce = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); return; }
    debounce.current = setTimeout(() => {
      api('/inventory/medicines/pos-search', { params: { q: q.trim() } })
        .then(d => setResults(d.results)).catch(() => {});
    }, 200);
  }, [q]);

  const add = r => {
    setCart(c => {
      const ex = c.find(i => i.batch_id === r.batch_id);
      if (ex) return c.map(i => i.batch_id === r.batch_id ? { ...i, qty: Math.min(i.qty + 1, r.qty) } : i);
      return [...c, { batch_id: r.batch_id, name: r.name, price: r.selling_price, qty: 1, stock: r.qty, batch_no: r.batch_no }];
    });
    setQ(''); setResults([]);
  };

  const onScan = ({ data }) => {
    if (!scanning) return;
    setScanning(false);
    api('/inventory/medicines/pos-search', { params: { q: data } })
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

  const total = Math.round(cart.reduce((a, i) => a + i.qty * i.price, 0));

  const save = async () => {
    if (!cart.length) return;
    setBusy(true);
    try {
      const d = await api('/sales', {
        method: 'POST',
        body: {
          items: cart.map(i => ({ batch_id: i.batch_id, qty: i.qty })),
          customer_phone: phone || undefined,
          payment: { cash: 0, upi: 0, card: 0, credit: 0, [payMode]: total },
        },
      });
      Alert.alert('Bill saved ✓', `${d.invoice_no}\nTotal ${fmt(d.total)}`);
      setCart([]); setPhone('');
    } catch (e) { Alert.alert('Could not save bill', e.message); }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
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
        <TextInput style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 8 }}
          placeholder="Customer mobile (optional)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
          {['cash', 'upi', 'card'].map(m => (
            <TouchableOpacity key={m} onPress={() => setPayMode(m)}
              style={{ flex: 1, padding: 8, borderRadius: 8, backgroundColor: payMode === m ? colors.brand : colors.brandLight }}>
              <Text style={{ textAlign: 'center', color: payMode === m ? '#fff' : colors.brand, fontWeight: '700' }}>{m.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={save} disabled={busy || !cart.length}
          style={{ backgroundColor: colors.green, borderRadius: 10, padding: 14, opacity: cart.length ? 1 : 0.5 }}>
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800', fontSize: 16 }}>
            💾 Save Bill — {fmt(total)}
          </Text>
        </TouchableOpacity>
      </View>

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
