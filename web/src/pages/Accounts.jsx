import React, { useEffect, useState } from 'react';
import { api, fmt, monthStart, today } from '../api.js';
import { useAuth, useBranch, can } from '../App.jsx';
import { Card, Table, Tabs, Modal, Field, Badge, Stat, useToast } from '../ui.jsx';
import { BarList } from '../charts.jsx';

export default function Accounts() {
  const { user } = useAuth();
  const [tab, setTab] = useState('expenses');
  const tabs = [{ key: 'expenses', label: '🧾 Expenses' }];
  if (can(user, 'accounts.manage')) {
    tabs.push({ key: 'closing', label: '💰 Daily Cash Closing' }, { key: 'upi', label: '📲 UPI Reconciliation' });
  }
  return (
    <div>
      <Tabs active={tab} onChange={setTab} tabs={tabs} />
      {tab === 'expenses' && <Expenses />}
      {tab === 'closing' && <CashClosing />}
      {tab === 'upi' && <UpiRecon />}
    </div>
  );
}

function Expenses() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const toast = useToast();
  const [d, setD] = useState({ expenses: [], by_category: [], total: 0 });
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [show, setShow] = useState(false);
  const [cats, setCats] = useState([]);

  const load = () => api('/accounts/expenses', { params: { ...range, branch_id: branchId } })
    .then(setD).catch(e => toast(e.message, 'red'));
  useEffect(() => { load(); }, [branchId, range.from, range.to]);
  useEffect(() => { api('/admin/settings').then(x => setCats(x.settings.expense_categories || [])); }, []);

  const del = async e => {
    if (!confirm(`Delete expense: ${e.category} ${fmt(e.amount)}?`)) return;
    try { await api(`/accounts/expenses/${e.id}`, { method: 'DELETE' }); toast('Deleted', 'green'); load(); }
    catch (err) { toast(err.message, 'red'); }
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
        <Card>
          <div className="toolbar">
            <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
            <div className="spacer" />
            <b>Total: {fmt(d.total)}</b>
            {can(user, 'expenses.manage') && <button className="btn" onClick={() => setShow(true)}>+ Add Expense</button>}
          </div>
          <Table columns={[
            { key: 'date', label: 'Date' },
            { key: 'category', label: 'Category', render: r => <Badge color="blue">{r.category}</Badge> },
            { key: 'branch_name', label: 'Branch' },
            { key: 'amount', label: 'Amount', num: true, render: r => <b>{fmt(r.amount)}</b> },
            { key: 'paid_method', label: 'Paid via' },
            { key: 'notes', label: 'Notes' },
            { key: 'created_by_name', label: 'By' },
            ...(can(user, 'expenses.manage') ? [{ label: '', render: r => <button className="x-btn" onClick={() => del(r)}>🗑</button> }] : []),
          ]} rows={d.expenses} />
        </Card>
        <Card title="By category">
          <BarList data={d.by_category.map(c => ({ label: c.category, value: c.total }))} color={2} />
        </Card>
      </div>
      {show && <ExpenseModal cats={cats} onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />}
    </div>
  );
}

function ExpenseModal({ cats, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ category: cats[0] || 'Miscellaneous', amount: '', date: today(), paid_method: 'cash', notes: '' });
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    try {
      await api('/accounts/expenses', { method: 'POST', body: { ...f, amount: Number(f.amount) } });
      toast('Expense saved', 'green'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  };
  return (
    <Modal title="Add expense" onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn green" onClick={save} disabled={!f.amount}>Save</button></>
    }>
      <div className="form-row">
        <Field label="Category"><select value={f.category} onChange={set('category')}>{cats.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Amount *" type="number" value={f.amount} onChange={set('amount')} />
      </div>
      <div className="form-row">
        <Field label="Date" type="date" value={f.date} onChange={set('date')} />
        <Field label="Paid via">
          <select value={f.paid_method} onChange={set('paid_method')}>
            <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option>
          </select>
        </Field>
      </div>
      <Field label="Notes" value={f.notes} onChange={set('notes')} />
    </Modal>
  );
}

function CashClosing() {
  const { user } = useAuth();
  const { branchId, branches, canSwitch } = useBranch();
  const toast = useToast();
  const activeBranch = canSwitch ? (branchId || branches[0]?.id) : user.branch_id;
  const [date, setDate] = useState(today());
  const [d, setD] = useState(null);
  const [actual, setActual] = useState('');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState([]);

  const load = () => {
    if (!activeBranch) return;
    api('/accounts/cash-closing', { params: { date, branch_id: activeBranch } })
      .then(x => { setD(x); setActual(x.closing?.actual_cash ?? ''); setDeposit(x.closing?.cash_deposited ?? ''); setNotes(x.closing?.notes ?? ''); })
      .catch(e => toast(e.message, 'red'));
    api('/accounts/cash-closing/history', { params: { branch_id: activeBranch } }).then(x => setHistory(x.closings));
  };
  useEffect(() => { load(); }, [date, activeBranch]);

  const save = async () => {
    try {
      const r = await api('/accounts/cash-closing', {
        method: 'POST',
        body: { date, branch_id: activeBranch, actual_cash: Number(actual), cash_deposited: Number(deposit) || 0, notes },
      });
      toast(`Closing saved. Difference: ${fmt(r.difference)}`, Math.abs(r.difference) > 0.01 ? 'red' : 'green');
      load();
    } catch (e) { toast(e.message, 'red'); }
  };

  if (!d) return null;
  const diff = actual === '' ? null : Number(actual) - d.expected_cash;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="toolbar">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        {canSwitch && (
          <select value={activeBranch} onChange={() => {}} disabled>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <span className="muted">Use the branch selector in the top bar to switch branch</span>
      </div>
      <div className="stats-row">
        <Stat accent="blue" label="Opening balance" value={fmt(d.opening_balance)} />
        <Stat accent="green" label="Cash sales" value={fmt(d.cash_sales)} sub={`+ receipts ${fmt(d.cash_receipts)}`} />
        <Stat accent="orange" label="Cash out" value={fmt(d.cash_expenses)} sub={`refunds ${fmt(d.cash_refunds)}`} />
        <Stat accent="blue" label="Expected cash in hand" value={fmt(d.expected_cash)} />
        <Stat accent="green" label="UPI today" value={fmt(d.upi_collections)} sub={`Card: ${fmt(d.card_collections)}`} />
      </div>
      <Card title={`Close the day — ${date}`}>
        <div className="form-row">
          <Field label="Counted cash (actual) *" type="number" value={actual} onChange={e => setActual(e.target.value)} />
          <Field label="Bank deposit today" type="number" value={deposit} onChange={e => setDeposit(e.target.value)} />
          <Field label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        {diff !== null && (
          <div className={Math.abs(diff) > 0.01 ? 'err-msg' : 'ok-msg'}>
            {Math.abs(diff) > 0.01 ? `Difference of ${fmt(diff)} vs expected ${fmt(d.expected_cash)}` : 'Cash tallies perfectly ✓'}
          </div>
        )}
        <button className="btn green" onClick={save} disabled={actual === ''}>
          {d.closing ? 'Update Closing' : 'Save Closing'}
        </button>
        {d.closing && <span className="muted" style={{ marginLeft: 12 }}>Closed earlier with difference {fmt(d.closing.difference)}</span>}
      </Card>
      <Card title="Closing history">
        <Table columns={[
          { key: 'date', label: 'Date' },
          { key: 'branch_name', label: 'Branch' },
          { key: 'opening_balance', label: 'Opening', num: true, render: r => fmt(r.opening_balance) },
          { key: 'cash_sales', label: 'Cash sales', num: true, render: r => fmt(r.cash_sales) },
          { key: 'expected_cash', label: 'Expected', num: true, render: r => fmt(r.expected_cash) },
          { key: 'actual_cash', label: 'Actual', num: true, render: r => fmt(r.actual_cash) },
          { key: 'difference', label: 'Diff', num: true, render: r => <b style={{ color: Math.abs(r.difference) > 0.01 ? 'var(--red)' : 'var(--green)' }}>{fmt(r.difference)}</b> },
          { key: 'cash_deposited', label: 'Deposited', num: true, render: r => fmt(r.cash_deposited) },
          { key: 'closed_by_name', label: 'By' },
        ]} rows={history} keyFn={r => r.id} />
      </Card>
    </div>
  );
}

function UpiRecon() {
  const { branchId } = useBranch();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api('/accounts/upi-reconciliation', { params: { branch_id: branchId } })
      .then(d => setRows(d.days)).catch(e => toast(e.message, 'red'));
  }, [branchId]);
  return (
    <Card title="Day-wise UPI collections — match against your UPI app settlement report">
      <Table columns={[
        { key: 'date', label: 'Date' },
        { key: 'bills', label: 'UPI bills', num: true },
        { key: 'upi_total', label: 'UPI total', num: true, render: r => <b>{fmt(r.upi_total)}</b> },
      ]} rows={rows} keyFn={r => r.date} />
    </Card>
  );
}
