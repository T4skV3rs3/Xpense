/* Xpense Phase 1 — pure financial calculations. No bank integrations. */
(function (root) {
  'use strict';

  const EXPENSE_CATEGORIES = [
    'Food & drinks', 'Groceries', 'Transportation', 'Bills & utilities',
    'Home & family', 'Shopping', 'Health', 'Personal', 'Subscriptions', 'Education', 'Other'
  ];
  const INCOME_CATEGORIES = ['Salary', 'Freelance income', 'Business income', 'Remittance', 'Refund', 'Gift', 'Other income'];

  function localISODate(date = new Date()) {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  function monthKey(date) { return String(date || '').slice(0, 7); }
  function isValidISODate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= monthDays[month - 1];
  }
  function id(prefix = 'id') {
    const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${random}`;
  }
  function roundMoney(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  function transactionInScope(tx, accountById) {
    if (!tx || !isValidISODate(tx.date) || tx.date > localISODate()) return false;
    const validForAccount = account => Boolean(account) &&
      (!account.openingDate || (isValidISODate(account.openingDate) && tx.date >= account.openingDate));
    if (tx.kind === 'transfer') {
      return validForAccount(accountById[tx.fromAccountId]) &&
        validForAccount(accountById[tx.toAccountId]);
    }
    if (['expense', 'income', 'adjustment'].includes(tx.kind)) {
      return validForAccount(accountById[tx.accountId]);
    }
    return false;
  }

  // Assets (cash, bank, wallet) are positive money held. Credit-card balances are positive debt owed.
  function accountBalance(account, transactions) {
    let balance = Number(account.openingBalance || 0);
    for (const tx of transactions) {
      if (!isValidISODate(tx.date) || tx.date > localISODate()) continue;
      if (account.openingDate && (!isValidISODate(account.openingDate) || tx.date < account.openingDate)) continue;
      const amount = Number(tx.amount || 0);
      if (tx.kind === 'expense' && tx.accountId === account.id) {
        balance += account.type === 'credit' ? amount : -amount;
      } else if (tx.kind === 'income' && tx.accountId === account.id) {
        balance += account.type === 'credit' ? -amount : amount; // e.g. a refund credited to a card
      } else if (tx.kind === 'transfer') {
        if (tx.fromAccountId === account.id) {
          balance += account.type === 'credit' ? amount : -amount; // cash advance adds debt
        }
        if (tx.toAccountId === account.id) {
          balance += account.type === 'credit' ? -amount : amount; // payment reduces card debt
        }
      } else if (tx.kind === 'adjustment' && tx.accountId === account.id) {
        balance += Number(tx.delta || 0);
      }
    }
    return roundMoney(balance);
  }

  function allBalances(accounts, transactions) {
    return Object.fromEntries(accounts.map(a => [a.id, accountBalance(a, transactions)]));
  }
  function totals(accounts, transactions, date = new Date()) {
    const month = localISODate(date).slice(0, 7);
    const balances = allBalances(accounts, transactions);
    const accountById = Object.fromEntries(accounts.map(a => [a.id, a]));
    const scopedTransactions = transactions.filter(tx => transactionInScope(tx, accountById));
    const assets = roundMoney(accounts.filter(a => a.type !== 'credit').reduce((s, a) => s + balances[a.id], 0));
    const liabilities = roundMoney(accounts.filter(a => a.type === 'credit').reduce((s, a) => s + balances[a.id], 0));
    const monthTx = scopedTransactions.filter(t => monthKey(t.date) === month);
    const income = roundMoney(monthTx.filter(t => t.kind === 'income' && t.category !== 'Refund').reduce((s, t) => s + Number(t.amount), 0));
    const expenses = roundMoney(monthTx.filter(t => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0));
    return {
      balances, assets, liabilities, netWorth: roundMoney(assets - liabilities),
      income, expenses, monthTx, budgetRemaining: null
    };
  }
  function categorySpend(transactions, month = localISODate().slice(0, 7), accounts = null) {
    const out = {};
    const accountById = Array.isArray(accounts) ? Object.fromEntries(accounts.map(a => [a.id, a])) : null;
    const scopedTransactions = transactions.filter(tx =>
      isValidISODate(tx.date) && (!accountById || transactionInScope(tx, accountById))
    );
    for (const t of scopedTransactions) {
      if (t.kind === 'expense' && monthKey(t.date) === month) {
        out[t.category || 'Other'] = roundMoney((out[t.category || 'Other'] || 0) + Number(t.amount));
      }
    }
    return out;
  }
  function monthlySeries(transactions, now = new Date(), count = 6, accounts = null) {
    const rows = [];
    const accountById = Array.isArray(accounts) ? Object.fromEntries(accounts.map(a => [a.id, a])) : null;
    for (let offset = count - 1; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthTx = transactions.filter(t =>
        isValidISODate(t.date) && monthKey(t.date) === key &&
        (!accountById || transactionInScope(t, accountById))
      );
      rows.push({
        key,
        label: d.toLocaleDateString('en-PH', { month: 'short' }),
        income: roundMoney(monthTx.filter(t => t.kind === 'income' && t.category !== 'Refund').reduce((s,t)=>s+Number(t.amount),0)),
        expenses: roundMoney(monthTx.filter(t => t.kind === 'expense').reduce((s,t)=>s+Number(t.amount),0))
      });
    }
    return rows;
  }
  function validateTransaction(tx, accounts) {
    const errors = [];
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Enter an amount greater than zero.');
    if (!isValidISODate(tx.date)) errors.push('Choose a valid date.');
    else if (tx.date > localISODate()) errors.push('Use today or an earlier date for a completed transaction. Future planned payments are not part of Phase 1.');
    const accountById = Object.fromEntries(accounts.map(a => [a.id, a]));
    if (tx.kind === 'expense' || tx.kind === 'income') {
      if (!accountById[tx.accountId]) errors.push('Choose an account.');
      else if (accountById[tx.accountId].openingDate && tx.date < accountById[tx.accountId].openingDate) errors.push('The transaction date is before this account’s tracking start. Choose a later date or set an earlier tracking start.');
      if (tx.kind === 'expense' && accountById[tx.accountId]?.type === 'credit' && !tx.category) errors.push('Choose an expense category.');
      if (tx.kind === 'income' && accountById[tx.accountId]?.type === 'credit' && tx.category !== 'Refund') errors.push('For a credit card, record incoming money as a refund only. Use a transfer to record a card payment.');
      if (!tx.category) errors.push('Choose a category.');
    } else if (tx.kind === 'transfer') {
      if (!accountById[tx.fromAccountId] || !accountById[tx.toAccountId]) errors.push('Choose both accounts.');
      else if ((accountById[tx.fromAccountId].openingDate && tx.date < accountById[tx.fromAccountId].openingDate) || (accountById[tx.toAccountId].openingDate && tx.date < accountById[tx.toAccountId].openingDate)) errors.push('The transfer date is before one account’s tracking start. Choose a later date or set an earlier tracking start.');
      if (tx.fromAccountId === tx.toAccountId) errors.push('Choose two different accounts.');
    } else {
      errors.push('Choose a supported transaction type.');
    }
    return errors;
  }

  const api = { EXPENSE_CATEGORIES, INCOME_CATEGORIES, localISODate, monthKey, isValidISODate, id, roundMoney, accountBalance, allBalances, totals, categorySpend, monthlySeries, validateTransaction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.XpenseLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
