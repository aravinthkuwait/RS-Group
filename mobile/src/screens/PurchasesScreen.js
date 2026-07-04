import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, fmt } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { colors, shadow } from '../theme';
import { Btn, BranchBar } from '../ui';

export default function PurchasesScreen({ navigation }) {
  const { user } = useAuth();
  const { branchId, options } = useBranch();
  const activeBranch = Number(branchId) || options[0]?.id || user.branch_id;
  const [rows, setRows] = useState([]);

  const load = useCallback(() => {
    api('/purchases', { params: { branch_id: activeBranch } })
      .then(d => setRows(d.purchases)).catch(() => {});
  }, [activeBranch]);
  useFocusEffect(load);

  const del = (p) => Alert.alert('Delete purchase?', `${p.invoice_no} — the stock it added will be reversed.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await api(`/purchases/${p.id}`, { method: 'DELETE' }); load(); }
      catch (e) { Alert.alert('Cannot delete', e.message); }
    } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar requireBranch />
      {can(user, 'purchases.manage') && (
        <Btn title="＋ New Purchase Entry" onPress={() => navigation.navigate('PurchaseEntry', { branchId: activeBranch })} />
      )}
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.ink3, marginTop: 30 }}>No purchases yet</Text>}
        renderItem={({ item }) => (
          <View style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }, shadow]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{item.invoice_no}</Text>
              <Text style={{ fontWeight: '800', color: colors.green }}>{fmt(item.total)}</Text>
            </View>
            <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 2 }}>{item.supplier_name}</Text>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              {item.invoice_date} · {item.branch_name}
              {item.pending_amount > 0.01 ? ` · due ${fmt(item.pending_amount)}` : ' · paid'}
            </Text>
            {can(user, 'purchases.manage') && item.status !== 'returned' && (
              <TouchableOpacity onPress={() => del(item)} style={{ marginTop: 6 }}>
                <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12 }}>🗑 Delete (reverse stock)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />
    </View>
  );
}
