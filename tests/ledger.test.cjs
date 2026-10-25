const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/ledger.js');

const accounts = [
  { id: 'cash', name: 'Cash', type: 'cash', openingBalance: 100 },
  { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 1000 },
  { id: 'card', name: 'Card', type: 'credit', openingBalance: 200 }
];

test('expense reduces an asset balance', () => {
  assert.equal(L.accountBalance(accounts[0], [{ kind: 'expense', accountId: 'cash', amount: 25, date: L.localISODate() }]), 75);
});

test('a credit-card purchase increases debt but records one expense', () => {
  const tx = [{ kind: 'expense', accountId: 'card', amount: 50, category: 'Food & drinks', date: L.localISODate() }];
  assert.equal(L.accountBalance(accounts[2], tx), 250);
  assert.equal(L.totals(accounts, tx).expenses, 50);
});

test('a card payment decreases cash and card debt without counting as an expense', () => {
  const tx = [{ kind: 'transfer', fromAccountId: 'bank', toAccountId: 'card', amount: 100, date: L.localISODate() }];
  assert.equal(L.accountBalance(accounts[1], tx), 900);
  assert.equal(L.accountBalance(accounts[2], tx), 100);
  assert.equal(L.totals(accounts, tx).expenses, 0);
  assert.equal(L.totals(accounts, tx).netWorth, 900);
});

test('moving money between asset accounts does not change net worth or expense totals', () => {
  const tx = [{ kind: 'transfer', fromAccountId: 'bank', toAccountId: 'cash', amount: 120, date: L.localISODate() }];
  const total = L.totals(accounts, tx);
  assert.equal(total.assets, 1100);
  assert.equal(total.liabilities, 200);
  assert.equal(total.netWorth, 900);
  assert.equal(total.expenses, 0);
  assert.equal(L.accountBalance(accounts[1], tx), 880);
  assert.equal(L.accountBalance(accounts[0], tx), 220);
});

test('income adds to asset balance, but a credit-card refund reduces debt', () => {
  const tx = [
    { kind: 'income', accountId: 'bank', amount: 500, date: L.localISODate(), category: 'Salary' },
    { kind: 'income', accountId: 'card', amount: 25, date: L.localISODate(), category: 'Refund' }
  ];
  assert.equal(L.accountBalance(accounts[1], tx), 1500);
  assert.equal(L.accountBalance(accounts[2], tx), 175);
  assert.equal(L.totals(accounts, tx).income, 500);
});

test('manual reconciliation adjustment changes balance but not income or expenses', () => {
  const tx = [{ kind: 'adjustment', accountId: 'cash', delta: -7.5, amount: 7.5, date: L.localISODate() }];
  assert.equal(L.accountBalance(accounts[0], tx), 92.5);
  assert.equal(L.totals(accounts, tx).income, 0);
  assert.equal(L.totals(accounts, tx).expenses, 0);
});

test('same-account transfer is rejected', () => {
  const errors = L.validateTransaction({ kind: 'transfer', amount: 5, date: L.localISODate(), fromAccountId: 'cash', toAccountId: 'cash' }, accounts);
  assert.ok(errors.some(e => e.includes('different accounts')));
});

test('opening balance only includes activity on or after its tracking start date', () => {
  const account = { id: 'startdated', name: 'Start dated', type: 'bank', openingBalance: 500, openingDate: '2026-10-10' };
  const tx = [
    { kind: 'expense', accountId: 'startdated', amount: 100, date: '2026-10-09' },
    { kind: 'expense', accountId: 'startdated', amount: 25, date: '2026-10-10' },
    { kind: 'income', accountId: 'startdated', amount: 10, date: '2026-10-11', category: 'Gift' }
  ];
  assert.equal(L.accountBalance(account, tx), 485);
});

test('completed transactions cannot be future-dated', () => {
  const future = new Date(Date.now() + 86400000);
  const date = L.localISODate(future);
  const errors = L.validateTransaction({ kind: 'expense', accountId: 'cash', amount: 5, date, category: 'Food & drinks' }, accounts);
  assert.ok(errors.some(e => e.includes('Future planned payments')));
});

test('income cannot be deposited to a credit card unless categorized as a refund', () => {
  const errors = L.validateTransaction({ kind: 'income', accountId: 'card', amount: 50, date: L.localISODate(), category: 'Salary' }, accounts);
  assert.ok(errors.some(e => e.includes('record incoming money as a refund')));
  const refundErrors = L.validateTransaction({ kind: 'income', accountId: 'card', amount: 50, date: L.localISODate(), category: 'Refund' }, accounts);
  assert.ok(!refundErrors.some(e => e.includes('record incoming money as a refund')));
});


test('calendar date validation rejects impossible days and invalid month values', () => {
  assert.equal(L.isValidISODate('2026-10-25'), true);
  assert.equal(L.isValidISODate('2024-02-29'), true);
  assert.equal(L.isValidISODate('2026-02-29'), false);
  assert.equal(L.isValidISODate('2026-02-31'), false);
  assert.equal(L.isValidISODate('2026-13-01'), false);
  assert.equal(L.isValidISODate('2026-1-01'), false);
});

test('account balances ignore undated and malformed legacy records', () => {
  const account = { id: 'cash', name: 'Cash', type: 'cash', openingBalance: 100, openingDate: '2026-10-01' };
  const tx = [
    { kind: 'expense', accountId: 'cash', amount: 15, date: '2026-10-02' },
    { kind: 'expense', accountId: 'cash', amount: 30 },
    { kind: 'expense', accountId: 'cash', amount: 40, date: '2026-10-31' },
    { kind: 'expense', accountId: 'cash', amount: 50, date: '2026-02-31' },
    { kind: 'expense', accountId: 'cash', amount: 20, date: '2026-09-30' }
  ];
  assert.equal(L.accountBalance(account, tx), 85);
});

test('monthly metrics, category budgets and chart ignore activity outside tracking scope', () => {
  const trackedAccounts = [
    { id: 'cash', name: 'Cash', type: 'cash', openingBalance: 100, openingDate: '2026-10-10' },
    { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 500, openingDate: '2026-10-10' }
  ];
  const tx = [
    { id: 'old-expense', kind: 'expense', accountId: 'cash', amount: 100, date: '2026-10-09', category: 'Food & drinks' },
    { id: 'current-expense', kind: 'expense', accountId: 'cash', amount: 25, date: '2026-10-10', category: 'Food & drinks' },
    { id: 'bad-account', kind: 'expense', accountId: 'missing', amount: 80, date: '2026-10-11', category: 'Food & drinks' },
    { id: 'old-transfer', kind: 'transfer', fromAccountId: 'cash', toAccountId: 'bank', amount: 40, date: '2026-10-09' },
    { id: 'current-income', kind: 'income', accountId: 'bank', amount: 200, date: '2026-10-12', category: 'Salary' }
  ];
  const snapshot = L.totals(trackedAccounts, tx, new Date('2026-10-15T12:00:00Z'));
  assert.equal(snapshot.expenses, 25);
  assert.equal(snapshot.income, 200);
  assert.equal(snapshot.monthTx.length, 2);
  assert.deepEqual(L.categorySpend(tx, '2026-10', trackedAccounts), { 'Food & drinks': 25 });
  const series = L.monthlySeries(tx, new Date('2026-10-15T12:00:00Z'), 1, trackedAccounts);
  assert.equal(series[0].expenses, 25);
  assert.equal(series[0].income, 200);
});

test('transaction validator rejects impossible calendar dates', () => {
  const errors = L.validateTransaction({
    kind: 'expense', amount: 5, date: '2026-02-31',
    accountId: 'cash', category: 'Food & drinks'
  }, accounts);
  assert.ok(errors.some(e => e.includes('valid date')));
});
