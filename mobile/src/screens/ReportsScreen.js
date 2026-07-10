import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Linking } from 'react-native';
import { api, fmt, BASE_URL, getAuthToken } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { colors, shadow } from '../theme';
import { Field, Chips, Btn, BranchBar } from '../ui';

const cell = { paddingVertical: 6, paddingHorizontal: 8, fontSize: 12, color: colors.ink2 };

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthStart = () => today().slice(0, 8) + '01';

// Masks free-text input into YYYY-MM-DD as the user types (web enforces this
// via <input type="date">; mirrors SalesScreen.js's maskDate).
const maskDate = v => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};

// Same tab keys/labels/order as web's REPORT_TABS (web/src/pages/Reports.jsx)
// so the same report reads identically on both clients.
const REPORT_TABS = [
  { key: 'sales', label: 'Daily / Monthly Sales' },
  { key: 'products', label: 'Product-wise Sales' },
  { key: 'staff', label: 'Staff Sales' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'stock', label: 'Stock (Batch-wise)' },
  { key: 'brands', label: 'Brand-wise Stock' },
  { key: 'generics', label: 'Generic-wise Stock' },
  { key: 'lowstock', label: 'Low Stock' },
  { key: 'expiry', label: 'Expiry' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'gst', label: 'GST / Tax' },
  { key: 'profit', label: 'Profit & Loss' },
];

// Same group labels as web's DISCOUNT_GROUPS.
const DISCOUNT_GROUPS = [
  { key: 'bill', label: 'Bill-wise' },
  { key: 'branch', label: 'Branch-wise' },
  { key: 'user', label: 'User-wise' },
  { key: 'customer', label: 'Customer-wise' },
  { key: 'product', label: 'Product-wise' },
];

export default function ReportsScreen() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const [key, setKey] = useState('sales');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState('bill'); // discounts report grouping

  useFocusEffect(useCallback(() => {
    setLoading(true);
    api(`/reports/${key}`, { params: { branch_id: branchId, from, to, group: key === 'discounts' ? group : undefined } })
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [key, branchId, from, to, group]));

  const exportUrl = format => {
    const qs = Object.entries({ format, from, to, branch_id: branchId, group: key === 'discounts' ? group : '' })
      .filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return `${BASE_URL}/api/reports/${key}/export?${qs}&token=${getAuthToken()}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <BranchBar />
      <Chips options={REPORT_TABS.map(t => ({ value: t.key, label: t.label }))}
        value={key} onChange={setKey} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Field label="From" placeholder="YYYY-MM-DD" keyboardType="numeric" maxLength={10}
          value={from} onChangeText={v => setFrom(maskDate(v))} /></View>
        <View style={{ flex: 1 }}><Field label="To" placeholder="YYYY-MM-DD" keyboardType="numeric" maxLength={10}
          value={to} onChangeText={v => setTo(maskDate(v))} /></View>
      </View>
      {key === 'discounts' && (
        <Chips label="Group by" value={group} onChange={setGroup}
          options={DISCOUNT_GROUPS.map(g => ({ value: g.key, label: g.label }))} />
      )}
      {key !== 'profit' && can(user, 'reports.export') && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Btn title="📄 PDF" color={colors.ink2} onPress={() => Linking.openURL(exportUrl('pdf'))} /></View>
          <View style={{ flex: 1 }}><Btn title="📊 Excel" color={colors.green} onPress={() => Linking.openURL(exportUrl('xlsx'))} /></View>
        </View>
      )}

      {loading && <ActivityIndicator color={colors.brand} style={{ marginTop: 30 }} />}

      {!loading && data && key === 'profit' && (
        <ScrollView>
          <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14 }, shadow]}>
            <Text style={{ fontWeight: '800', marginBottom: 8 }}>Profit & Loss · {data.from} → {data.to}</Text>
            {[['Revenue', data.revenue], ['Refunds', -data.refunds], ['Cost of goods', -data.cogs],
              ['Gross profit', data.gross_profit], ['Expenses', -data.total_expenses],
              ['GST collected', data.gst_collected], ['Net profit', data.net_profit]].map(([l, v]) => (
              <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderColor: colors.line }}>
                <Text style={{ color: colors.ink2, fontWeight: l.includes('profit') ? '800' : '400' }}>{l}</Text>
                <Text style={{ fontWeight: '700', color: v < 0 ? colors.red : colors.ink }}>{fmt(Math.abs(v))}{v < 0 ? ' −' : ''}</Text>
              </View>
            ))}
            {data.expenses?.length > 0 && (
              <>
                <Text style={{ fontWeight: '700', marginTop: 10, marginBottom: 4, fontSize: 12, color: colors.ink3 }}>EXPENSES BY CATEGORY</Text>
                {data.expenses.map(e => (
                  <View key={e.category} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                    <Text style={{ color: colors.ink2, fontSize: 12 }}>{e.category}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600' }}>{fmt(e.total)}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>
      )}

      {!loading && data && key !== 'profit' && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {(data.summary || []).map(([l, v]) => (
              <View key={l} style={[{ backgroundColor: '#fff', borderRadius: 10, padding: 10, flex: 1, minWidth: '45%' }, shadow]}>
                <Text style={{ fontSize: 10, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>{l}</Text>
                <Text style={{ fontWeight: '800', marginTop: 2 }}>{String(v)}</Text>
              </View>
            ))}
          </View>
          {(() => {
            // Bill-level reports (sales, discounts by-bill) carry sale_id on each
            // row — show a View/Print action so a report doubles as a bill lookup.
            const showBillCol = can(user, 'billing.view', 'billing.create') && data.rows[0]?.sale_id !== undefined;
            const viewPdf = id => Linking.openURL(`${BASE_URL}/api/sales/${id}/pdf?token=${getAuthToken()}`);
            return (
              <ScrollView horizontal style={{ flex: 1 }}>
                <ScrollView>
                  <View style={[{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden' }, shadow]}>
                    <View style={{ flexDirection: 'row', backgroundColor: colors.brandLight }}>
                      {data.columns.map(c => (
                        <Text key={c.key} style={[cell, { fontWeight: '800', color: colors.brand, minWidth: 90 }]}>{c.label}</Text>
                      ))}
                      {showBillCol && <Text style={[cell, { fontWeight: '800', color: colors.brand, minWidth: 130 }]}>Bill</Text>}
                    </View>
                    {data.rows.map((r, i) => (
                      <View key={i} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line }}>
                        {data.columns.map(c => (
                          <Text key={c.key} style={[cell, { minWidth: 90, textAlign: c.align || 'left' }]} numberOfLines={1}>
                            {r[c.key] === null || r[c.key] === undefined ? '—' : String(r[c.key])}
                          </Text>
                        ))}
                        {showBillCol && (
                          <View style={[cell, { minWidth: 130, flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
                            {/* Two separate actions (both open the PDF — RN has no window.print()
                                equivalent) to match web's distinct View/Print buttons. */}
                            <TouchableOpacity onPress={() => viewPdf(r.sale_id)}>
                              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>👁 View</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => viewPdf(r.sale_id)}>
                              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>🖨 Print</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))}
                    {data.rows.length === 0 && <Text style={[cell, { padding: 16 }]}>No records found</Text>}
                  </View>
                </ScrollView>
              </ScrollView>
            );
          })()}
        </>
      )}
    </View>
  );
}
