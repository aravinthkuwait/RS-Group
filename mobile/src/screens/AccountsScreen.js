import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { api, fmt } from '../api';
import { useAuth, useBranch, can } from '../../App';
import { Field, Chips, Btn, BranchBar, shareCsv } from '../ui';
import { colors, shadow } from '../theme';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';

const EXPENSE_COLS = [
  { key: 'date', label: 'Date' }, { key: 'category', label: 'Category' },
  { key: 'branch_name', label: 'Branch' }, { key: 'amount', label: 'Amount' },
  { key: 'paid_method', label: 'Paid via' }, { key: 'notes', label: 'Notes' },
  { key: 'created_by_name', label: 'By' },
];
const CLOSING_COLS = [
  { key: 'date', label: 'Date' }, { key: 'branch_name', label: 'Branch' },
  { key: 'opening_balance', label: 'Opening' }, { key: 'cash_sales', label: 'Cash sales' },
  { key: 'expected_cash', label: 'Expected' }, { key: 'actual_cash', label: 'Actual' },
  { key: 'difference', label: 'Difference' }, { key: 'cash_deposited', label: 'Deposited' },
  { key: 'closed_by_name', label: 'By' },
];
const UPI_COLS = [
  { key: 'date', label: 'Date' }, { key: 'bills', label: 'UPI bills' }, { key: 'upi_total', label: 'UPI total' },
];

function Card({ title, children, right }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 }, shadow]}>
      {(title || right) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontWeight: '800', flex: 1 }}>{title}</Text>
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <View style={[{ backgroundColor: '#fff', borderRadius: 12, padding: 12, flex: 1, minWidth: '46%', borderTopWidth: 3, borderTopColor: accent }, shadow]}>
      <Text style={{ fontSize: 10, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '800', marginTop: 3 }}>{value}</Text>
      {!!sub && <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

function CsvBtn({ name, columns, rows }) {
  const disabled = !rows?.length;
  return (
    <TouchableOpacity onPress={() => shareCsv(name, columns, rows)} disabled={disabled}
      style={{ backgroundColor: colors.brandLight, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 12 }}>⬇ CSV</Text>
    </TouchableOpacity>
  );
}

export default function AccountsScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState('expenses');
  const tabs = [{ value: 'expenses', label: '🧾 Expenses' }];
  if (can(user, 'accounts.manage')) {
    tabs.push({ value: 'closing', label: '💰 Daily Cash Closing' }, { value: 'upi', label: '📲 UPI Reconciliation' });
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, padding: 12 }}>
      <Chips value={tab} onChange={setTab} options={tabs} />
      {tab === 'expenses' && <Expenses />}
      {tab === 'closing' && <CashClosing />}
      {tab === 'upi' && <UpiRecon />}
    </View>
  );
}

// ---------------- Expenses ----------------
function Expenses() {
  const { user } = useAuth();
  const { branchId, options, canSwitch } = useBranch();
  const activeBranch = canSwitch ? (Number(branchId) || options[0]?.id) : user.branch_id;
  const [d, setD] = useState({ expenses: [], by_category: [], total: 0 });
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [show, setShow] = useState(false);
  const [cats, setCats] = useState([]);

  const load = () => api('/accounts/expenses', { params: { ...range, branch_id: branchId } })
    .then(setD).catch(e => Alert.alert('Error', e.message));
  useEffect(() => { load(); }, [branchId, range.from, range.to]);
  useEffect(() => {
    api('/admin/settings').then(x => setCats(x.settings.expense_categories || [])).catch(() => {});
  }, []);

  const del = e => Alert.alert('Delete expense?', `${e.category} ${fmt(e.amount)}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await api(`/accounts/expenses/${e.id}`, { method: 'DELETE' }); Alert.alert('Deleted'); load(); }
      catch (err) { Alert.alert('Error', err.message); }
    } },
  ]);

  const manage = can(user, 'expenses.manage');
  const maxCat = Math.max(...d.by_category.map(c => Number(c.total)), 1);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
      <BranchBar />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="From (YYYY-MM-DD)" value={range.from} autoCapitalize="none"
            onChangeText={v => setRange(r => ({ ...r, from: v }))} placeholder="YYYY-MM-DD" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="To (YYYY-MM-DD)" value={range.to} autoCapitalize="none"
            onChangeText={v => setRange(r => ({ ...r, to: v }))} placeholder="YYYY-MM-DD" />
        </View>
      </View>
      {manage && <Btn title="＋ Add Expense" onPress={() => setShow(true)} />}

      <Card title={`Expenses — Total ${fmt(d.total)}`}
        right={<CsvBtn name="expenses" columns={EXPENSE_COLS} rows={d.expenses} />}>
        {d.expenses.length === 0 && <Text style={{ color: colors.ink3, textAlign: 'center', paddingVertical: 12 }}>No expenses in this range</Text>}
        {d.expenses.map(e => (
          <View key={e.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ backgroundColor: colors.brandLight, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
                <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 11 }}>{e.category}</Text>
              </View>
              <Text style={{ flex: 1, color: colors.ink3, fontSize: 12 }}>{e.date}</Text>
              <Text style={{ fontWeight: '800' }}>{fmt(e.amount)}</Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 2 }}>
              {e.branch_name} · {e.paid_method}{e.created_by_name ? ` · by ${e.created_by_name}` : ''}
            </Text>
            {!!e.notes && <Text style={{ color: colors.ink2, fontSize: 12 }}>{e.notes}</Text>}
            {manage && (
              <TouchableOpacity onPress={() => del(e)} style={{ marginTop: 4 }}>
                <Text style={{ color: colors.red, fontWeight: '700', fontSize: 12 }}>🗑 Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </Card>

      <Card title="By category">
        {d.by_category.length === 0 && <Text style={{ color: colors.ink3 }}>Nothing yet</Text>}
        {d.by_category.map(c => (
          <View key={c.category} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', fontSize: 13 }}>{c.category}</Text>
              <Text style={{ color: colors.ink2, fontSize: 13, fontWeight: '700' }}>{fmt(c.total)}</Text>
            </View>
            <View style={{ height: 6, backgroundColor: colors.line, borderRadius: 3, marginTop: 3, overflow: 'hidden' }}>
              <View style={{ width: `${(Number(c.total) / maxCat) * 100}%`, height: '100%', backgroundColor: colors.brand }} />
            </View>
          </View>
        ))}
      </Card>

      <Modal visible={show} animationType="slide" onRequestClose={() => setShow(false)}>
        {show && (
          <ExpenseForm cats={cats} branchId={activeBranch} options={options} canPick={canSwitch}
            onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />
        )}
      </Modal>
    </ScrollView>
  );
}

function ExpenseForm({ cats, branchId, options, canPick, onClose, onSaved }) {
  const [f, setF] = useState({ category: cats[0] || 'Miscellaneous', amount: '', date: today(), paid_method: 'cash', notes: '', branch_id: branchId });
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      await api('/accounts/expenses', { method: 'POST', body: { ...f, amount: Number(f.amount), branch_id: Number(f.branch_id) } });
      Alert.alert('Expense saved');
      onSaved();
    } catch (e) { Alert.alert('Could not save', e.message); }
    setBusy(false);
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, paddingTop: 50 }}>
      <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>Add expense</Text>
      {canPick && (
        <Chips label="Branch *" value={f.branch_id} onChange={set('branch_id')}
          options={options.map(b => ({ value: b.id, label: b.name }))} />
      )}
      <Chips label="Category" value={f.category} onChange={set('category')}
        options={(cats.length ? cats : ['Miscellaneous']).map(c => ({ value: c, label: c }))} />
      <Field label="Amount *" keyboardType="decimal-pad" value={String(f.amount)} onChangeText={set('amount')} />
      <Field label="Date (YYYY-MM-DD)" autoCapitalize="none" value={f.date} onChangeText={set('date')} />
      <Chips label="Paid via" value={f.paid_method} onChange={set('paid_method')}
        options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank' }]} />
      <Field label="Notes" value={f.notes} onChangeText={set('notes')} />
      <Btn title={busy ? 'Saving…' : '💾 Save Expense'} color={colors.green} onPress={save} disabled={busy || !f.amount} />
      <Btn title="Cancel" color={colors.ink3} onPress={onClose} />
    </ScrollView>
  );
}

// ---------------- Daily cash closing ----------------
function CashClosing() {
  const { user } = useAuth();
  const { branchId, options, canSwitch } = useBranch();
  const activeBranch = canSwitch ? (Number(branchId) || options[0]?.id) : user.branch_id;
  const [date, setDate] = useState(today());
  const [d, setD] = useState(null);
  const [actual, setActual] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!activeBranch) return;
    api('/accounts/cash-closing', { params: { date, branch_id: activeBranch } })
      .then(x => {
        setD(x);
        setActual(x.closing ? String(x.closing.actual_cash) : '');
        setDeposit(x.closing ? String(x.closing.cash_deposited) : '');
        setNotes(x.closing?.notes ?? '');
      })
      .catch(e => Alert.alert('Error', e.message));
    api('/accounts/cash-closing/history', { params: { branch_id: activeBranch } })
      .then(x => setHistory(x.closings)).catch(() => {});
  };
  useEffect(() => { load(); }, [date, activeBranch]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/accounts/cash-closing', {
        method: 'POST',
        body: { date, branch_id: activeBranch, actual_cash: Number(actual), cash_deposited: Number(deposit) || 0, notes },
      });
      Alert.alert('Closing saved', `Difference: ${fmt(r.difference)}`);
      load();
    } catch (e) { Alert.alert('Error', e.message); }
    setBusy(false);
  };

  const diff = d && actual !== '' ? Number(actual) - d.expected_cash : null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
      <BranchBar requireBranch />
      <Field label="Date (YYYY-MM-DD)" autoCapitalize="none" value={date} onChangeText={setDate} />
      {!d ? <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <Stat label="Opening balance" value={fmt(d.opening_balance)} accent={colors.brand} />
            <Stat label="Cash sales" value={fmt(d.cash_sales)} sub={`+ receipts ${fmt(d.cash_receipts)}`} accent={colors.green} />
            <Stat label="Cash out" value={fmt(d.cash_expenses)} sub={`refunds ${fmt(d.cash_refunds)}`} accent={colors.orange} />
            <Stat label="Expected cash in hand" value={fmt(d.expected_cash)} accent={colors.brand} />
            <Stat label="UPI today" value={fmt(d.upi_collections)} sub={`Card: ${fmt(d.card_collections)}`} accent={colors.green} />
          </View>

          <Card title={`Close the day — ${date}`}>
            <Field label="Counted cash (actual) *" keyboardType="decimal-pad" value={actual} onChangeText={setActual} />
            <Field label="Bank deposit today" keyboardType="decimal-pad" value={deposit} onChangeText={setDeposit} />
            <Field label="Notes" value={notes} onChangeText={setNotes} />
            {diff !== null && (
              <Text style={{ color: Math.abs(diff) > 0.01 ? colors.red : colors.green, fontWeight: '700', marginBottom: 8 }}>
                {Math.abs(diff) > 0.01 ? `Difference of ${fmt(diff)} vs expected ${fmt(d.expected_cash)}` : 'Cash tallies perfectly ✓'}
              </Text>
            )}
            <Btn title={busy ? 'Saving…' : d.closing ? '💾 Update Closing' : '💾 Save Closing'} color={colors.green}
              onPress={save} disabled={busy || actual === ''} />
            {!!d.closing && (
              <Text style={{ color: colors.ink3, fontSize: 12 }}>Closed earlier with difference {fmt(d.closing.difference)}</Text>
            )}
          </Card>
        </>
      )}

      <Card title="Closing history" right={<CsvBtn name="cash-closings" columns={CLOSING_COLS} rows={history} />}>
        {history.length === 0 && <Text style={{ color: colors.ink3 }}>No closings yet</Text>}
        {history.map(r => (
          <View key={r.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{r.date} · {r.branch_name}</Text>
              <Text style={{ fontWeight: '800', color: Math.abs(r.difference) > 0.01 ? colors.red : colors.green }}>
                {fmt(r.difference)}
              </Text>
            </View>
            <Text style={{ color: colors.ink3, fontSize: 12, marginTop: 2 }}>
              Opening {fmt(r.opening_balance)} · Cash sales {fmt(r.cash_sales)} · Expected {fmt(r.expected_cash)} · Actual {fmt(r.actual_cash)}
            </Text>
            <Text style={{ color: colors.ink3, fontSize: 12 }}>
              Deposited {fmt(r.cash_deposited)}{r.closed_by_name ? ` · by ${r.closed_by_name}` : ''}
            </Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

// ---------------- UPI reconciliation ----------------
function UpiRecon() {
  const { branchId } = useBranch();
  const [rows, setRows] = useState([]);
  const load = () => api('/accounts/upi-reconciliation', { params: { branch_id: branchId } })
    .then(d => setRows(d.days)).catch(e => Alert.alert('Error', e.message));
  useEffect(() => { load(); }, [branchId]);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
      <BranchBar />
      <Card title="Day-wise UPI collections — match against your UPI app settlement report"
        right={<CsvBtn name="upi-collections" columns={UPI_COLS} rows={rows} />}>
        {rows.length === 0 && <Text style={{ color: colors.ink3 }}>No UPI collections yet</Text>}
        {rows.map(r => (
          <View key={r.date} style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderColor: colors.line, paddingVertical: 9 }}>
            <Text style={{ flex: 1, fontWeight: '600' }}>{r.date}</Text>
            <Text style={{ color: colors.ink3, fontSize: 12, marginRight: 10 }}>{r.bills} bills</Text>
            <Text style={{ fontWeight: '800' }}>{fmt(r.upi_total)}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
