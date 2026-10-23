const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/ledger.js');

const accounts = [
  { id: 'cash', name: 'Cash', type: 'cash', openingBalance: 100 },
  { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 1000 },
  { id: 'card', name: 'Card', type: 'credit', openingBalance: 200 }
];

test('expense reduces an asset balance', () => {
  assert.equal(L.accountBalance(accounts[0], [{ kind: 'expense', accountId: 'cash', amount: 25 }]), 75);
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
