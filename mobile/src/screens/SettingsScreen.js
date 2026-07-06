import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Linking, Switch, ActivityIndicator } from 'react-native';
import { api, fmt, BASE_URL, getAuthToken } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

function Card({ title, children }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 }, shadow]}>
      {!!title && <Text style={{ fontWeight: '800', marginBottom: 10 }}>{title}</Text>}
      {children}
    </View>
  );
}

const Muted = ({ children, style }) => (
  <Text style={[{ color: colors.ink3, fontSize: 12 }, style]}>{children}</Text>
);

export default function SettingsScreen() {
  const { user } = useAuth();
  // Mirror web Settings.jsx tab gating (Branches has its own screen in the app).
  const sections = [{ value: 'account', label: '🔐 My Account' }];
  if (can(user, 'settings.manage')) sections.push({ value: 'company', label: '🏢 Company & Invoice' }, { value: 'lists', label: '🏷 Categories & Taxes' });
  if (can(user, 'settings.manage')) sections.push({ value: 'permissions', label: '🛡 Role Permissions' });
  if (can(user, 'audit.view', 'settings.manage')) sections.push({ value: 'audit', label: '📜 Activity Log' });
  const [section, setSection] = useState('account');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
      <Chips options={sections} value={section} onChange={setSection} />
      {section === 'account' && <MyAccount />}
      {section === 'company' && <Company />}
      {section === 'lists' && <Lists />}
      {section === 'permissions' && <Permissions />}
      {section === 'audit' && <Audit />}
    </ScrollView>
  );
}

// ---------------- My Account ----------------
function MyAccount() {
  const { user } = useAuth();
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [sessions, setSessions] = useState({ sessions: [], current: '' });
  const [history, setHistory] = useState([]);

  const load = () => {
    api('/auth/sessions').then(setSessions).catch(() => {});
    api('/auth/login-history').then(d => setHistory(d.history)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const changePw = async () => {
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      Alert.alert('Done', 'Password changed');
      setPw({ current_password: '', new_password: '' });
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const revoke = s => {
    Alert.alert('Sign out device?', `${s.device || 'Device'} (${s.ip || '—'}) will be signed out.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        try { await api(`/auth/sessions/${s.id}/revoke`, { method: 'POST', body: {} }); } catch {}
        load();
      } },
    ]);
  };

  const isAdmin = ['super_admin', 'branch_admin'].includes(user.role);
  return (
    <View>
      <Card title="Change password">
        <Field label="Current password" secureTextEntry value={pw.current_password}
          onChangeText={t => setPw(p => ({ ...p, current_password: t }))} />
        <Field label="New password (min 6 chars)" secureTextEntry value={pw.new_password}
          onChangeText={t => setPw(p => ({ ...p, new_password: t }))} />
        <Btn title="Update Password" onPress={changePw} disabled={!pw.current_password || pw.new_password.length < 6} />
      </Card>

      <Card title="Active sessions & devices">
        {sessions.sessions.filter(s => !s.revoked).map(s => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: colors.line }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', fontSize: 13 }}>{s.device || 'Unknown device'}</Text>
              <Muted>{s.ip || '—'} · {s.last_seen || s.created_at}</Muted>
            </View>
            {s.id === sessions.current ? (
              <Text style={{ color: colors.green, fontWeight: '700', fontSize: 12 }}>this device</Text>
            ) : (
              <TouchableOpacity onPress={() => revoke(s)}
                style={{ backgroundColor: colors.red, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Sign out</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </Card>

      <Card title={isAdmin ? 'Login history (all users)' : 'My login history'}>
        {history.map(r => (
          <View key={r.id} style={{ paddingVertical: 7, borderTopWidth: 1, borderColor: colors.line }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', fontSize: 13, flex: 1 }} numberOfLines={1}>
                {isAdmin ? (r.user_name || r.email) : r.device}
              </Text>
              <Text style={{ color: r.success ? colors.green : colors.red, fontWeight: '700', fontSize: 12 }}>
                {r.success ? 'success' : 'failed'}
              </Text>
            </View>
            <Muted>{r.created_at} · {r.device} · {r.ip || '—'}</Muted>
          </View>
        ))}
      </Card>
    </View>
  );
}

// ---------------- Company & Invoice ----------------
const COMPANY_KEYS = ['name', 'division', 'address', 'phone', 'email', 'gstin', 'drug_license'];

function Company() {
  const { user } = useAuth();
  const [s, setS] = useState(null);
  useEffect(() => { api('/admin/settings').then(d => setS(d.settings)).catch(e => Alert.alert('Error', e.message)); }, []);
  if (!s) return <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />;

  const save = async key => {
    try {
      await api(`/admin/settings/${key}`, { method: 'PUT', body: { value: s[key] } });
      Alert.alert('Done', 'Settings saved');
    } catch (e) { Alert.alert('Error', e.message); }
  };
  const setC = (k, v) => setS(x => ({ ...x, company: { ...x.company, [k]: v } }));
  const setI = (k, v) => setS(x => ({ ...x, invoice: { ...x.invoice, [k]: v } }));

  return (
    <View>
      <Card title="Company profile (shown on invoices)">
        {COMPANY_KEYS.map(k => (
          <Field key={k} label={k.replace(/_/g, ' ').toUpperCase()} value={String(s.company?.[k] || '')}
            onChangeText={t => setC(k, t)} />
        ))}
        <Btn title="Save Company" color={colors.green} onPress={() => save('company')} />
      </Card>

      <Card title="Invoice format">
        <Field label="Invoice heading note" value={String(s.invoice?.prefix_note || '')} onChangeText={t => setI('prefix_note', t)} />
        <Field label="Terms line" value={String(s.invoice?.terms || '')} onChangeText={t => setI('terms', t)} />
        <Field label="Footer message" value={String(s.invoice?.footer || '')} onChangeText={t => setI('footer', t)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Switch value={!!s.invoice?.show_savings} onValueChange={v => setI('show_savings', v)}
            trackColor={{ true: colors.brand }} />
          <Text style={{ marginLeft: 8, fontSize: 13 }}>Show "You saved {fmt(0).charAt(0)}X" on bills</Text>
        </View>
        <Btn title="Save Invoice Settings" color={colors.green} onPress={() => save('invoice')} />
      </Card>

      <Card title="Backup & help">
        <Btn title="⬇ Download full backend backup (JSON)" color={colors.green}
          onPress={() => Linking.openURL(`${BASE_URL}/api/admin/backup?token=${getAuthToken()}`)} />
        <Btn title="📖 Download User Manual (PDF)"
          onPress={() => Linking.openURL(`${BASE_URL}/api/manual?token=${getAuthToken()}`)} />
        <Muted>
          Downloads every table — branches, users, medicines, stock, bills, customers, expenses — as one file.
          Database-level backups & point-in-time restore are also managed automatically by Supabase.
        </Muted>
      </Card>

      {user.role === 'super_admin' && <FreshStart />}
    </View>
  );
}

function FreshStart() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const wipe = () => {
    Alert.alert('⚠ Delete ALL data?',
      'This permanently deletes ALL branches, staff accounts, medicines, stock, bills, customers, suppliers and expenses. It cannot be undone. Download a backup first if you want to keep a copy.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, delete everything', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          const r = await api('/admin/factory-reset', { method: 'POST', body: { password, confirm } });
          Alert.alert('Done', r.message);
          setPassword(''); setConfirm('');
        } catch (e) { Alert.alert('Error', e.message); }
        setBusy(false);
      } },
    ]);
  };

  return (
    <Card title="🗑 Fresh start (danger zone)">
      <Muted style={{ marginBottom: 10 }}>
        Removes every auto-created record: sample branches, staff, medicines, stock, bills, customers,
        suppliers, expenses. Keeps your owner login and settings.
      </Muted>
      <Field label="Your password" secureTextEntry value={password} onChangeText={setPassword} />
      <Field label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm}
        placeholder="DELETE" autoCapitalize="characters" />
      <Btn title={busy ? 'Deleting…' : 'Delete ALL demo data — start fresh'} color={colors.red}
        onPress={wipe} disabled={busy || confirm !== 'DELETE' || !password} />
    </Card>
  );
}

// ---------------- Categories & Taxes ----------------
const LIST_KEYS = [
  { k: 'medicine_categories', title: 'Medicine categories' },
  { k: 'expense_categories', title: 'Expense categories' },
  { k: 'gst_rates', title: 'GST rates (%)' },
  { k: 'payment_types', title: 'Payment types' },
];

function ListEditor({ k, title, initial }) {
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState('');

  const save = async next => {
    const value = next.map(v => (k === 'gst_rates' ? Number(v) : v));
    try {
      await api(`/admin/settings/${k}`, { method: 'PUT', body: { value } });
      setItems(next);
    } catch (e) { Alert.alert('Error', e.message); }
  };
  const add = () => {
    const v = draft.trim();
    if (!v || items.map(String).includes(v)) return;
    setDraft('');
    save([...items, v]);
  };
  const remove = v => {
    Alert.alert('Remove?', `Remove "${v}" from ${title.toLowerCase()}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => save(items.filter(x => String(x) !== String(v))) },
    ]);
  };

  return (
    <Card title={title}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {items.map(v => (
          <TouchableOpacity key={String(v)} onPress={() => remove(v)}
            style={{ flexDirection: 'row', backgroundColor: colors.brandLight, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 }}>
            <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>{String(v)}  ✕</Text>
          </TouchableOpacity>
        ))}
        {!items.length && <Muted>No entries yet.</Muted>}
      </View>
      <Field label="Add entry" value={draft} onChangeText={setDraft} placeholder="Type and press Add"
        keyboardType={k === 'gst_rates' ? 'numeric' : 'default'} onSubmitEditing={add} />
      <Btn title="Add" onPress={add} disabled={!draft.trim()} />
    </Card>
  );
}

function Lists() {
  const [s, setS] = useState(null);
  useEffect(() => { api('/admin/settings').then(d => setS(d.settings)).catch(e => Alert.alert('Error', e.message)); }, []);
  if (!s) return <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />;
  return (
    <View>
      <Muted style={{ marginBottom: 10 }}>Tap an entry to remove it. Changes are saved immediately.</Muted>
      {LIST_KEYS.map(({ k, title }) => <ListEditor key={k} k={k} title={title} initial={s[k] || []} />)}
    </View>
  );
}

// ---------------- Role Permissions ----------------
function Permissions() {
  const [d, setD] = useState(null);
  const [role, setRole] = useState('branch_manager');
  useEffect(() => { api('/admin/permissions').then(setD).catch(e => Alert.alert('Error', e.message)); }, []);
  if (!d) return <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />;

  const perms = d.matrix[role] || [];
  const toggle = p => setD(x => ({
    ...x,
    matrix: { ...x.matrix, [role]: perms.includes(p) ? perms.filter(y => y !== p) : [...perms, p] },
  }));
  const save = async () => {
    try {
      await api(`/admin/permissions/${role}`, { method: 'PUT', body: { permissions: perms } });
      Alert.alert('Done', `Permissions updated for ${role.replace(/_/g, ' ')}. Users get them on next request.`);
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const groups = {};
  d.all_permissions.forEach(p => {
    const g = p.split('.')[0];
    (groups[g] = groups[g] || []).push(p);
  });

  return (
    <View>
      <Chips label="Role" value={role} onChange={setRole}
        options={d.roles.filter(r => r !== 'super_admin').map(r => ({ value: r, label: r.replace(/_/g, ' ') }))} />
      <Card title="Role permission matrix">
        {Object.entries(groups).map(([g, list]) => (
          <View key={g} style={{ marginBottom: 8 }}>
            <Text style={{ fontWeight: '800', fontSize: 13, textTransform: 'capitalize', marginBottom: 2 }}>{g}</Text>
            {list.map(p => (
              <TouchableOpacity key={p} onPress={() => toggle(p)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderColor: colors.line }}>
                <Text style={{ fontSize: 16, color: perms.includes(p) ? colors.brand : colors.ink3, width: 26 }}>
                  {perms.includes(p) ? '☑' : '☐'}
                </Text>
                <Text style={{ fontSize: 13, color: colors.ink2 }}>{p.split('.')[1].replace(/_/g, ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <Btn title="Save Permissions" color={colors.green} onPress={save} />
        <Muted>Super admin always has every permission. Per-user overrides are available via the API.</Muted>
      </Card>
    </View>
  );
}

// ---------------- Activity Log ----------------
const AUDIT_CSV_COLS = [
  { key: 'created_at', label: 'Time' }, { key: 'user_name', label: 'User' },
  { key: 'branch_name', label: 'Branch' }, { key: 'action', label: 'Action' },
  { key: 'entity', label: 'Entity' }, { key: 'details', label: 'Details' }, { key: 'ip', label: 'IP' },
];

function AuditDetails({ text }) {
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      return (
        <View>
          {Object.entries(obj).map(([field, v]) => (
            <Text key={field} style={{ fontSize: 12 }}>
              <Text style={{ fontWeight: '700' }}>{field}</Text>
              <Text style={{ color: colors.ink3 }}>: {String(v.old ?? '')}</Text> → {String(v.new ?? '')}
            </Text>
          ))}
        </View>
      );
    }
  } catch { /* plain text */ }
  return <Muted>{text}</Muted>;
}

function Audit() {
  const [rows, setRows] = useState(null);
  const [limit, setLimit] = useState(100);
  useEffect(() => {
    api('/admin/audit-logs', { params: { limit } }).then(d => setRows(d.logs)).catch(e => Alert.alert('Error', e.message));
  }, [limit]);
  if (!rows) return <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />;

  return (
    <Card title="Activity log — every important action is recorded">
      <Btn title="⇪ Export CSV" onPress={() => shareCsv('activity-log.csv', AUDIT_CSV_COLS, rows)} />
      {rows.map(r => (
        <View key={r.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.line }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', fontSize: 13, flex: 1 }} numberOfLines={1}>
              {r.user_name || '—'}{r.branch_name ? ` · ${r.branch_name}` : ''}
            </Text>
            <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>{r.action}</Text>
          </View>
          <Muted>{r.created_at} · {r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}{r.ip ? ` · ${r.ip}` : ''}</Muted>
          <AuditDetails text={r.details} />
        </View>
      ))}
      {rows.length >= limit && limit < 1000 && (
        <Btn title="Load more" color={colors.ink2} onPress={() => setLimit(l => Math.min(l + 100, 1000))} />
      )}
    </Card>
  );
}
