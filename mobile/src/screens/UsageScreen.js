import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Linking, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { colors, shadow } from '../theme';

const fmtSize = b => {
  const n = Number(b || 0);
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
};
const levelColor = { high: colors.red, med: colors.orange, low: colors.brand, ok: colors.green };

function Stat({ label, value, sub, accent }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 12, flex: 1, minWidth: '46%', borderTopWidth: 3, borderTopColor: accent }, shadow]}>
      <Text style={{ fontSize: 10, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 3 }}>{value}</Text>
      {!!sub && <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

const CLEANUPS = [
  { key: 'sessions', label: 'Stale / revoked sessions', count: d => d.growth.sessions.stale },
  { key: 'login_history', label: 'Login history > 90 days', count: d => d.growth.login_history.old },
  { key: 'notifications', label: 'Read notifications > 30 days', count: d => d.growth.notifications.read },
  { key: 'audit_logs', label: 'Audit entries > 1 year', count: d => (d.growth.audit_logs.rows > 50000 ? d.growth.audit_logs.rows : 0) },
  { key: 'prescriptions', label: 'Prescription files > 6 months', count: d => d.blobs.prescriptions.count, sub: d => fmtSize(d.blobs.prescriptions.bytes) },
  { key: 'invoice_files', label: 'Supplier invoice files > 6 months', count: d => d.blobs.invoices.count, sub: d => fmtSize(d.blobs.invoices.bytes) },
];

export default function UsageScreen() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => { api('/admin/usage').then(setD).catch(e => Alert.alert('Error', e.message)); }, []);
  useFocusEffect(load);

  const cleanup = (target, label, n) => {
    Alert.alert('Clean up?', `Clean up ${label}? This permanently deletes ${n} rows to free space.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clean up', style: 'destructive', onPress: async () => {
        setBusy(target);
        try { const r = await api('/admin/usage/cleanup', { method: 'POST', body: { target } }); Alert.alert('Done', r.message); load(); }
        catch (e) { Alert.alert('Error', e.message); }
        setBusy('');
      } },
    ]);
  };

  if (!d) return <View style={{ flex: 1, backgroundColor: colors.surface, justifyContent: 'center' }}><ActivityIndicator color={colors.brand} /></View>;
  const blobBytes = d.blobs.prescriptions.bytes + d.blobs.invoices.bytes;
  const topTables = d.tables.slice(0, 14);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 12, gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="Database size" value={fmtSize(d.db_bytes)} sub="total on Supabase" accent={colors.brand} />
        <Stat label="Files in DB" value={fmtSize(blobBytes)} sub={`${d.blobs.prescriptions.count} Rx + ${d.blobs.invoices.count} inv`} accent={blobBytes > 20 * 1048576 ? colors.red : colors.orange} />
        <Stat label="Bills (30d)" value={String(d.activity.bills_30d)} sub={`${d.activity.active_sessions} active sessions`} accent={colors.green} />
        <Stat label="Audit rows" value={String(d.growth.audit_logs.rows)} sub={`since ${d.growth.audit_logs.oldest || '—'}`} accent={colors.orange} />
      </View>

      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14 }, shadow]}>
        <Text style={{ fontWeight: '800', marginBottom: 8 }}>What to resolve</Text>
        {d.recommendations.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: levelColor[r.level], marginTop: 5 }} />
            <Text style={{ flex: 1, color: colors.ink2, fontSize: 13 }}>{r.text}</Text>
          </View>
        ))}
      </View>

      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14 }, shadow]}>
        <Text style={{ fontWeight: '800', marginBottom: 8 }}>Storage by table</Text>
        {topTables.map(t => (
          <View key={t.name} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', fontSize: 13 }}>{t.name}</Text>
              <Text style={{ color: colors.ink3, fontSize: 12 }}>{fmtSize(t.bytes)} · {t.pct}%</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 11 }}>{Number(t.est_rows).toLocaleString('en-IN')} rows</Text>
            <View style={{ height: 7, backgroundColor: colors.line, borderRadius: 4, marginTop: 3, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, t.pct)}%`, height: '100%', backgroundColor: t.pct > 30 ? colors.red : t.pct > 12 ? colors.orange : colors.brand }} />
            </View>
          </View>
        ))}
      </View>

      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14 }, shadow]}>
        <Text style={{ fontWeight: '800', marginBottom: 2 }}>Reclaim space (safe cleanup)</Text>
        <Text style={{ color: colors.ink3, fontSize: 12, marginBottom: 8 }}>Frees storage & shrinks backups. Business data is untouched.</Text>
        {CLEANUPS.map(c => {
          const n = c.count(d);
          const has = Number(n) > 0;
          return (
            <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: colors.line, opacity: has ? 1 : 0.5 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600' }}>{c.label}</Text>
                <Text style={{ color: colors.ink3, fontSize: 12 }}>{has ? n : 0}{c.sub && has ? ` · ${c.sub(d)}` : ''}</Text>
              </View>
              <TouchableOpacity disabled={!has || busy === c.key} onPress={() => cleanup(c.key, c.label, n)}
                style={{ backgroundColor: has ? colors.brandLight : colors.line, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 }}>
                <Text style={{ color: has ? colors.brand : colors.ink3, fontWeight: '700', fontSize: 12 }}>{busy === c.key ? '…' : 'Clean'}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14 }, shadow]}>
        <Text style={{ fontWeight: '800', marginBottom: 2 }}>Provider billing</Text>
        <Text style={{ color: colors.ink3, fontSize: 12, marginBottom: 8 }}>Exact ₹ amounts live with each provider:</Text>
        {d.providers.map(p => (
          <TouchableOpacity key={p.name} onPress={() => Linking.openURL(p.url)}
            style={{ paddingVertical: 9, borderTopWidth: 1, borderColor: colors.line }}>
            <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 13 }}>{p.name} ↗</Text>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{p.drivers}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
