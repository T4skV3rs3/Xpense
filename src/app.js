(function () {
  'use strict';
  const L = window.XpenseLedger;
  const STORAGE_KEY = 'xpense-phase1-v1';
  const DEFAULT_BUDGETS = {
    'Food & drinks': 3500, 'Groceries': 1800, 'Transportation': 2000,
    'Bills & utilities': 2500, 'Home & family': 1500, 'Shopping': 2500,
    'Health': 1000, 'Personal': 1000, 'Subscriptions': 600,
    'Education': 1500, 'Other': 1000
  };
  let data = null;
  let activeView = 'overview';
  let toastTimer = null;
  let activeAccountEditId = null;
  let activeReconcileAccountId = null;
  let storageRecoveryBlocked = false;
  let pendingStorageWarning = false;
  let startupStorageWarning = '';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (n, decimals = 2) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(n) || 0);
  const compactMoney = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: Math.abs(n) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(n) >= 100000 ? 1 : 0 }).format(Number(n) || 0);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmtDate = value => {
    if (!value) return '\u2014';
    const d = new Date(`${value}T12:00:00`);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  };
  const accountLabel = a => a ? a.name : 'Unknown account';
  const accountTypeLabel = type => ({ cash: 'Cash', bank: 'Bank account', ewallet: 'E-wallet', credit: 'Credit card' }[type] || type);
  const accountIcon = type => ({ cash: '\u25c9', bank: '\u25a4', ewallet: '\u25a3', credit: '\u25b1' }[type] || '\u25c9');
  const txIcon = tx => tx.kind === 'expense' ? '\u2198' : tx.kind === 'income' ? '\u2197' : tx.kind === 'transfer' ? '\u21c4' : '\u00b1';
  const txTitle = tx => tx.note?.trim() || (tx.kind === 'expense' ? tx.category || 'Expense' : tx.kind === 'income' ? tx.category || 'Income' : tx.kind === 'transfer' ? 'Transfer / payment' : 'Balance adjustment');
  const txKindLabel = tx => ({ expense: 'Expense', income: 'Income', transfer: 'Transfer', adjustment: 'Adjustment' }[tx.kind] || 'Activity');
  const txAccountLabel = tx => {
    const map = accountMap();
    if (tx.kind === 'transfer') return `${accountLabel(map[tx.fromAccountId])} \u2192 ${accountLabel(map[tx.toAccountId])}`;
    return accountLabel(map[tx.accountId]);
  };
  const evidenceLabel = type => ({ none: 'Quick note', paper: 'Paper receipt', digital: 'Digital record' }[type] || 'Quick note');

  function newId(prefix) { return L.id(prefix); }
  function dateForMonth(offset, day) {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0).getDate();
    return L.localISODate(new Date(now.getFullYear(), now.getMonth() + offset, Math.min(day, last), 12));
  }
  function makeTx(kind, amount, date, extra = {}) {
    return { id: newId('tx'), kind, amount, date, note: '', category: '', evidenceType: 'none', evidenceNote: '', createdAt: new Date().toISOString(), ...extra };
  }
  function createDemoData() {
    const accounts = [
      { id: 'acc-cash', name: 'Cash wallet', type: 'cash', openingBalance: 1500, openingDate: dateForMonth(-5, 1), createdAt: new Date().toISOString() },
      { id: 'acc-bdo', name: 'BDO main account', type: 'bank', openingBalance: 8000, openingDate: dateForMonth(-5, 1), createdAt: new Date().toISOString() },
      { id: 'acc-gcash', name: 'GCash wallet', type: 'ewallet', openingBalance: 1000, openingDate: dateForMonth(-5, 1), createdAt: new Date().toISOString() },
      { id: 'acc-union', name: 'UnionBank savings', type: 'bank', openingBalance: 15000, openingDate: dateForMonth(-5, 1), createdAt: new Date().toISOString() },
      { id: 'acc-card', name: 'Everyday credit card', type: 'credit', openingBalance: 8000, openingDate: dateForMonth(-5, 1), createdAt: new Date().toISOString() }
    ];
    const tx = [];
    for (let m = -5; m <= 0; m++) {
      tx.push(makeTx('income', 25000, dateForMonth(m, 1), { id: `sample-salary-${m}`, accountId: 'acc-bdo', category: 'Salary', note: 'Monthly salary', evidenceType: 'digital', evidenceNote: 'Payroll credit' }));
      tx.push(makeTx('transfer', 5000, dateForMonth(m, 2), { id: `sample-gcash-${m}`, fromAccountId: 'acc-bdo', toAccountId: 'acc-gcash', note: 'Top up GCash' }));
      tx.push(makeTx('transfer', 1500, dateForMonth(m, 2), { id: `sample-cash-${m}`, fromAccountId: 'acc-bdo', toAccountId: 'acc-cash', note: 'Cash withdrawal' }));
      tx.push(makeTx('transfer', 2000, dateForMonth(m, 3), { id: `sample-savings-${m}`, fromAccountId: 'acc-bdo', toAccountId: 'acc-union', note: 'Move to savings' }));
      tx.push(makeTx('expense', 2200, dateForMonth(m, 5), { id: `sample-bills-${m}`, accountId: 'acc-bdo', category: 'Bills & utilities', note: 'Electricity & water', evidenceType: 'digital', evidenceNote: 'Monthly bills' }));
      tx.push(makeTx('expense', 800, dateForMonth(m, 7), { id: `sample-groceries-${m}`, accountId: 'acc-gcash', category: 'Groceries', note: 'Market groceries', evidenceType: 'paper', evidenceNote: 'Grocery receipt' }));
      tx.push(makeTx('expense', 2600, dateForMonth(m, 9), { id: `sample-food-${m}`, accountId: 'acc-gcash', category: 'Food & drinks', note: 'Food & coffee', evidenceType: 'digital', evidenceNote: 'E-wallet activity' }));
      tx.push(makeTx('expense', 600, dateForMonth(m, 10), { id: `sample-transport-${m}`, accountId: 'acc-gcash', category: 'Transportation', note: 'Ride & commute', evidenceType: 'none' }));
      tx.push(makeTx('expense', 1000, dateForMonth(m, 11), { id: `sample-cash-transport-${m}`, accountId: 'acc-cash', category: 'Transportation', note: 'Jeepney & tricycle', evidenceType: 'none' }));
      tx.push(makeTx('expense', 500, dateForMonth(m, 12), { id: `sample-personal-${m}`, accountId: 'acc-cash', category: 'Personal', note: 'Personal care', evidenceType: 'paper' }));
      tx.push(makeTx('expense', 800, dateForMonth(m, 14), { id: `sample-telecom-${m}`, accountId: 'acc-bdo', category: 'Bills & utilities', note: 'Phone & internet', evidenceType: 'digital', evidenceNote: 'Payment confirmation' }));
      tx.push(makeTx('expense', 400, dateForMonth(m, 16), { id: `sample-subscriptions-${m}`, accountId: 'acc-bdo', category: 'Subscriptions', note: 'Digital subscriptions', evidenceType: 'digital' }));
      tx.push(makeTx('expense', 1400, dateForMonth(m, 18), { id: `sample-shopping-${m}`, accountId: 'acc-card', category: 'Shopping', note: 'Household purchase', evidenceType: 'paper', evidenceNote: 'Store receipt' }));
      tx.push(makeTx('transfer', 2500, dateForMonth(m, 21), { id: `sample-card-payment-${m}`, fromAccountId: 'acc-bdo', toAccountId: 'acc-card', note: 'Credit-card payment' }));
    }
    return { version: 1, demo: true, accounts, transactions: tx.sort((a, b) => a.date.localeCompare(b.date)), budgets: { ...DEFAULT_BUDGETS }, customCategories: [], createdAt: new Date().toISOString() };
  }
  function freshData() { return { version: 1, demo: false, accounts: [], transactions: [], budgets: { ...DEFAULT_BUDGETS }, customCategories: [], createdAt: new Date().toISOString() }; }
  function loadData() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      startupStorageWarning = 'Browser storage is unavailable. Xpense can run for this session, but entries may not survive a reload.';
      console.warn('Could not read Xpense local data.', err);
      return createDemoData();
    }
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.accounts) &&
            Array.isArray(parsed.transactions) && parsed.budgets &&
            typeof parsed.budgets === 'object' && !Array.isArray(parsed.budgets)) return parsed;
        storageRecoveryBlocked = true;
        startupStorageWarning = 'Xpense found saved data it does not recognize and has left it untouched. Restore a full JSON backup, or choose Start fresh only if you accept replacing the unreadable data.';
      } catch (err) {
        storageRecoveryBlocked = true;
        startupStorageWarning = 'Xpense could not read its saved data and has left it untouched. Restore a full JSON backup, or choose Start fresh only if you accept replacing the unreadable data.';
        console.warn('Could not parse Xpense local data.', err);
      }
      return createDemoData();
    }
    const initial = createDemoData();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    } catch (err) {
      startupStorageWarning = 'Browser storage is unavailable. Xpense can run for this session, but entries may not survive a reload.';
      console.warn('Could not initialize Xpense local storage.', err);
    }
    return initial;
  }
  function saveData(allowReplaceUnreadable = false) {
    if (storageRecoveryBlocked && !allowReplaceUnreadable) {
      pendingStorageWarning = true;
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      storageRecoveryBlocked = false;
      pendingStorageWarning = false;
      startupStorageWarning = '';
      return true;
    } catch (err) {
      pendingStorageWarning = true;
      startupStorageWarning = 'Browser storage could not save the latest changes. They may exist only in this session; export a full backup if possible and avoid reloading.';
      console.error('Could not save Xpense data.', err);
      return false;
    }
  }
  function accountsList() { return [...data.accounts]; }
  function accountMap() { return Object.fromEntries(data.accounts.map(a => [a.id, a])); }
  function categoriesFor(kind) {
    const base = kind === 'income' ? L.INCOME_CATEGORIES : L.EXPENSE_CATEGORIES;
    return [...new Set([...base, ...(data.customCategories || [])])];
  }
  function monthTx() {
    const month = L.localISODate().slice(0, 7);
    return data.transactions.filter(tx => tx.date?.slice(0, 7) === month);
  }
  function showToast(message, type = 'success') {
    if (pendingStorageWarning) {
      const detail = storageRecoveryBlocked
        ? 'Saved data was left untouched. This change exists only in memory and will be lost if you reload. Restore a full backup, or intentionally start fresh.'
        : 'Browser storage could not save this change. It may be lost on reload; export a full backup if possible.';
      message = type === 'error' ? message + ' ' + detail : detail;
      type = 'error';
      pendingStorageWarning = false;
    }
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = 'toast show ' + (type === 'error' ? 'toast-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
  }
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
    const input = el.querySelector('input:not([type=hidden]), select, button');
    setTimeout(() => input?.focus(), 60);
  }
  function closeModal(el) {
    const modal = typeof el === 'string' ? document.getElementById(el) : el;
    if (modal) modal.classList.add('hidden');
    if (!$('.modal-overlay:not(.hidden)')) document.body.classList.remove('modal-open');
  }
  function switchView(view) {
    if (!['overview', 'activity', 'budget', 'accounts'].includes(view)) view = 'overview';
    activeView = view;
    $$('.view-page').forEach(p => p.classList.toggle('active', p.id === `view-${view}`));
    $$('.nav-item[data-view], .mobile-nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const labels = { overview: 'Overview', activity: 'Activity', budget: 'Budget', accounts: 'Accounts' };
    $('#pageCrumb').textContent = labels[view];
    const mobileTitles = { overview: 'Your money', activity: 'Activity', budget: 'Budget', accounts: 'Accounts' };
    document.title = `${mobileTitles[view]} — Xpense`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderView(view);
  }
  function renderView(view) {
    if (view === 'overview') renderOverview();
    if (view === 'activity') renderActivity();
    if (view === 'budget') renderBudget();
    if (view === 'accounts') renderAccounts();
    $('#activityCount').textContent = String(data.transactions.length);
  }
  function renderAll() {
    $('#todayLabel').textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
    $('#demoNotice').classList.toggle('hidden', !data.demo);
    $('#startFreshBtn').textContent = data.demo ? 'Start fresh' : 'Clear workspace';
    $('#useOwnDataBtn').textContent = 'Start with my own data →';
    const warning = $('#storageWarning');
    warning.textContent = startupStorageWarning;
    warning.classList.toggle('hidden', !startupStorageWarning);
    $('.local-save').innerHTML = startupStorageWarning
      ? '<span class="local-dot storage-error-dot"></span> Storage needs attention'
      : '<span class="local-dot"></span> Saved on this device';
    $('#activityCount').textContent = String(data.transactions.length);
    renderOverview(); renderActivity(); renderBudget(); renderAccounts(); switchView(activeView);
  }
  function createTxEmpty(message, desc, buttonText = 'Record money') {
    return `<div class=\"empty-state\"><div class=\"empty-icon\">↕</div><strong>${esc(message)}</strong><p>${esc(desc)}</p><button class=\"button button-primary\" data-open-add>${esc(buttonText)}</button></div>`;
  }
  function transactionRow(tx, activity = false) {
    const map = accountMap();
    let account = txAccountLabel(tx);
    let category = tx.kind === 'transfer' ? 'Transfer / payment' : tx.kind === 'adjustment' ? 'Reconciliation' : tx.category || txKindLabel(tx);
    const sign = tx.kind === 'expense' ? '−' : tx.kind === 'income' ? '+' : tx.kind === 'adjustment' ? (Number(tx.delta) < 0 ? '−' : '+') : '↔';
    let val = tx.kind === 'adjustment' ? Math.abs(Number(tx.delta)) : Number(tx.amount);
    const amountClass = tx.kind === 'income' ? 'amount-positive' : tx.kind === 'expense' ? 'amount-negative' : tx.kind === 'adjustment' ? (Number(tx.delta) < 0 ? 'amount-negative' : 'amount-positive') : 'amount-neutral';
    const recordBadge = tx.evidenceType === 'paper' ? '<span class=\"record-tag record-paper\">Paper receipt</span>' : tx.evidenceType === 'digital' ? '<span class=\"record-tag record-digital\">Digital record</span>' : '<span class=\"record-tag record-note\">Quick note</span>';
    const note = tx.evidenceNote ? `<div class=\"sub-text truncate\">${esc(tx.evidenceNote)}</div>` : '';
    const row = `<tr>
      <td><div class=\"transaction-cell\"><span class=\"transaction-symbol ${tx.kind === 'income' ? 'symbol-income' : tx.kind === 'expense' ? 'symbol-expense' : 'symbol-transfer'}\">${txIcon(tx)}</span><div class=\"transaction-copy\"><strong>${esc(txTitle(tx))}</strong><span>${esc(category)}</span>${activity && tx.note && tx.note !== txTitle(tx) ? `<span>${esc(tx.note)}</span>` : ''}</div></div></td>
      <td><div class=\"account-cell\">${esc(account)}</div></td>
      <td><span class=\"date-cell\">${esc(fmtDate(tx.date))}</span></td>
      ${activity ? `<td><div>${recordBadge}${note}</div></td>` : `<td><span class=\"type-pill type-${tx.kind}\">${esc(txKindLabel(tx))}</span></td>`}
      <td class=\"th-amount\"><span class=\"transaction-amount ${amountClass}\">${sign === '↔' ? '' : sign}${money(val)}</span></td>
      ${activity ? `<td class=\"row-action-cell\"><button class=\"row-action\" data-delete-tx=\"${esc(tx.id)}\" aria-label=\"Delete transaction\" title=\"Delete transaction\">⋯</button></td>` : ''}
    </tr>`;
    return row;
  }
  function renderOverview() {
    const totals = L.totals(data.accounts, data.transactions);
    $('#statAssets').textContent = money(totals.assets);
    $('#statExpenses').textContent = money(totals.expenses);
    $('#statIncome').textContent = money(totals.income);
    $('#statNetWorth').textContent = money(totals.netWorth);
    $('#expenseCompare').textContent = `${totals.monthTx.filter(t => t.kind === 'expense').length} recorded expense${totals.monthTx.filter(t => t.kind === 'expense').length === 1 ? '' : 's'} this month`;
    $('#liabilityNote').textContent = `${money(totals.liabilities)} in tracked debt`;
    const series = L.monthlySeries(data.transactions, new Date(), 6, data.accounts);
    const max = Math.max(1, ...series.flatMap(x => [x.income, x.expenses]));
    $('#cashflowChart').innerHTML = series.map(m => {
      const ih = Math.max(m.income > 0 ? 3 : 0, m.income / max * 116);
      const eh = Math.max(m.expenses > 0 ? 3 : 0, m.expenses / max * 116);
      const current = m.key === L.localISODate().slice(0, 7) ? ' current-month' : '';
      return `<div class=\"chart-month${current}\"><div class=\"bar-pair\"><div class=\"chart-bar income-bar\" style=\"height:${ih}px\" title=\"Income ${esc(money(m.income))}\"></div><div class=\"chart-bar expense-bar\" style=\"height:${eh}px\" title=\"Expenses ${esc(money(m.expenses))}\"></div></div><span>${esc(m.label)}</span></div>`;
    }).join('');
    const spending = L.categorySpend(data.transactions, undefined, data.accounts);
    const allBudgetTotal = Object.values(data.budgets).reduce((s, v) => s + Number(v || 0), 0);
    const totalSpentBudgeted = Object.keys(data.budgets).reduce((s, category) => s + Number(spending[category] || 0), 0);
    $('#budgetTotal').textContent = compactMoney(allBudgetTotal);
    $('#budgetLeft').textContent = compactMoney(allBudgetTotal - totalSpentBudgeted);
    $('#budgetTotalFill').style.width = `${allBudgetTotal ? Math.min(100, totalSpentBudgeted / allBudgetTotal * 100) : 0}%`;
    const topBudgets = Object.entries(data.budgets).filter(([, limit]) => Number(limit) > 0).map(([category, limit]) => ({ category, limit: Number(limit), spent: Number(spending[category] || 0) })).sort((a, b) => b.spent / b.limit - a.spent / a.limit).slice(0, 4);
    $('#budgetSnapshotList').innerHTML = topBudgets.length ? topBudgets.map(b => {
      const pct = b.limit > 0 ? Math.min(100, b.spent / b.limit * 100) : 0;
      return `<div class=\"budget-mini-item\"><div class=\"budget-mini-top\"><span>${esc(b.category)}</span><span>${money(b.spent,0)} <i>/ ${money(b.limit,0)}</i></span></div><div class=\"progress-track\"><span class=\"${pct >= 100 ? 'progress-over' : pct >= 80 ? 'progress-warn' : ''}\" style=\"width:${pct}%\"></span></div></div>`;
    }).join('') : `<div class=\"muted-empty\">No budget limits set yet. Add one to start planning.</div>`;
    const over = topBudgets.filter(b => b.spent > b.limit);
    $('#budgetInsight').innerHTML = over.length ? `<span class=\"insight-star\">✳</span><span><strong>${esc(over[0].category)}</strong> is ₱${(over[0].spent - over[0].limit).toLocaleString('en-PH')} above its limit. Review your plan or check for missing entries.</span>` : `<span class=\"insight-star\">✳</span><span>Your budget works best when you record purchases as they happen. Figures update from your entries.</span>`;
    const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 5);
    $('#recentRows').innerHTML = recent.map(tx => transactionRow(tx, false)).join('');
    $('#recentEmpty').classList.toggle('hidden', recent.length > 0);
    $('.recent-panel .transaction-table-wrap').classList.toggle('hidden', recent.length === 0);
  }
  function populateMonthFilter() {
    const select = $('#activityMonth');
    const existing = select.value;
    const keys = [...new Set(data.transactions.map(t => (t.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    select.innerHTML = '<option value=\"all\">All dates</option>' + keys.map(key => {
      const [y, m] = key.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
      return `<option value=\"${key}\">${esc(label)}</option>`;
    }).join('');
    if (keys.includes(existing) || existing === 'all') select.value = existing;
  }
  function renderActivity() {
    populateMonthFilter();
    const q = ($('#activitySearch')?.value || '').trim().toLowerCase();
    const type = $('#activityFilter')?.value || 'all';
    const month = $('#activityMonth')?.value || 'all';
    let rows = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    rows = rows.filter(tx => {
      const haystack = [tx.note, tx.category, tx.evidenceNote, tx.kind, tx.evidenceType, txAccountLabel(tx)].join(' ').toLowerCase();
      return (!q || haystack.includes(q)) && (type === 'all' || tx.kind === type) && (month === 'all' || tx.date?.slice(0, 7) === month);
    });
    $('#activityRows').innerHTML = rows.map(tx => transactionRow(tx, true)).join('');
    $('#activityResultTitle').textContent = type === 'all' ? 'All transactions' : `${type[0].toUpperCase()}${type.slice(1)}s`;
    $('#activityResultSubtitle').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'} shown · transfers don't count as spending`;
    $('#activityEmpty').classList.toggle('hidden', rows.length > 0);
    $('.activity-panel .transaction-table-wrap').classList.toggle('hidden', rows.length === 0);
  }
  function renderBudget() {
    const spend = L.categorySpend(data.transactions, undefined, data.accounts);
    const limits = Object.entries(data.budgets).filter(([category]) => category);
    const total = limits.reduce((s, [, v]) => s + Number(v || 0), 0);
    const spent = Object.values(spend).reduce((s, v) => s + Number(v || 0), 0);
    const remaining = total - limits.reduce((s, [category]) => s + Number(spend[category] || 0), 0);
    $('#budgetHeroTotal').textContent = money(total, 0);
    $('#budgetHeroSpent').textContent = money(spent, 0);
    $('#budgetHeroRemaining').textContent = money(remaining, 0);
    $('#budgetHeroPercent').textContent = `${total ? Math.round(spent / total * 100) : 0}% of your total plan used (including unbudgeted categories in spending)`;
    $('#budgetFullList').innerHTML = limits.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).map(([category, limit]) => {
      const value = Number(spend[category] || 0);
      const pct = Number(limit) > 0 ? value / Number(limit) * 100 : 0;
      const status = Number(limit) <= 0 ? 'No limit set' : value > Number(limit) ? `Over by ${money(value - Number(limit),0)}` : `${money(Number(limit) - value,0)} left`;
      const statusClass = value > Number(limit) && Number(limit) > 0 ? 'over-status' : 'good-status';
      return `<article class=\"budget-full-card\"><div class=\"budget-full-head\"><div class=\"budget-category-mark\">${categoryIcon(category)}</div><div class=\"budget-category-copy\"><strong>${esc(category)}</strong><span>${money(value,0)} spent</span></div><div class=\"budget-status ${statusClass}\">${esc(status)}</div></div><div class=\"progress-track progress-large\"><span class=\"${pct >= 100 ? 'progress-over' : pct >= 80 ? 'progress-warn' : ''}\" style=\"width:${Math.min(100,pct)}%\"></span></div><div class=\"budget-full-footer\"><span>${Number(limit) > 0 ? `${Math.round(pct)}% used` : 'Set a limit to track progress'}</span><button class=\"small-text-button\" data-edit-budget=\"${esc(category)}\">Edit limit</button></div></article>`;
    }).join('');
  }
  function categoryIcon(category) {
    const icons = { 'Food & drinks':'◉','Groceries':'▦','Transportation':'↗','Bills & utilities':'ϟ','Home & family':'⌂','Shopping':'◇','Health':'✚','Personal':'✳','Subscriptions':'▣','Education':'▤','Other':'•','Salary':'↗','Freelance income':'↗','Business income':'↗','Remittance':'↗','Refund':'↶','Gift':'✳','Other income':'↗' };
    return icons[category] || '•';
  }
  function renderAccounts() {
    const t = L.totals(data.accounts, data.transactions);
    $('#accountAssetsTotal').textContent = money(t.assets);
    $('#accountDebtTotal').textContent = money(t.liabilities);
    $('#accountCount').textContent = String(data.accounts.length);
    $('#accountsGrid').innerHTML = data.accounts.length ? data.accounts.map(a => {
      const b = t.balances[a.id] || 0;
      const isCredit = a.type === 'credit';
      const related = data.transactions.filter(tx => tx.accountId === a.id || tx.fromAccountId === a.id || tx.toAccountId === a.id).length;
      return `<article class=\"account-card\"><div class=\"account-card-top\"><div class=\"account-symbol ${isCredit ? 'account-symbol-credit' : ''}\">${accountIcon(a.type)}</div><span class=\"account-kind\">${esc(accountTypeLabel(a.type))}</span></div><h3>${esc(a.name)}</h3><p>${isCredit ? 'Outstanding debt tracked' : 'Calculated account balance'}</p><div class=\"account-balance ${isCredit ? 'balance-debt' : ''}\">${money(b)}</div><div class=\"account-card-footer\"><span>Tracking since ${esc(fmtDate(a.openingDate))} · ${related} record${related === 1 ? '' : 's'}</span><button class=\"text-link\" data-reconcile-account=\"${esc(a.id)}\">Confirm balance ↗</button></div><button class=\"account-remove\" data-delete-account=\"${esc(a.id)}\" title=\"Remove account\" aria-label=\"Remove ${esc(a.name)}\">×</button></article>`;
    }).join('') : `<div class=\"empty-state accounts-empty\"><div class=\"empty-icon\">▤</div><strong>No accounts added yet</strong><p>Add cash, a bank account, an e-wallet or a credit card. Xpense will calculate balances from your opening amounts and records.</p><button class=\"button button-primary\" id=\"emptyAddAccount\">+ Add your first account</button></div>`;
  }
  function openTransactionModal(kind = 'expense') {
    if (!data.accounts.length) {
      showToast('Add an account first, then you can record money.', 'error');
      switchView('accounts');
      setTimeout(() => openAccountModal(), 100);
      return;
    }
    $('#transactionForm').reset();
    $('#txDate').value = L.localISODate();
    $('#txAmount').value = '';
    $('#txNote').value = '';
    $('#txEvidenceNote').value = '';
    $$('input[name=\"evidenceType\"]').forEach(r => r.checked = r.value === 'none');
    updateEvidenceNoteLabel();
    setTransactionKind(kind);
    openModal('transactionModal');
  }
  function setTransactionKind(kind) {
    $('#txKind').value = kind;
    $$('.kind-option').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    $('#transferDestinationWrap').classList.toggle('hidden', kind !== 'transfer');
    $('#categoryWrap').classList.toggle('hidden', kind === 'transfer');
    $('#txCategory').required = kind !== 'transfer';
    $('#txDestination').required = kind === 'transfer';
    $('#txAccountLabel').innerHTML = kind === 'expense' ? 'Where did the money come from? <b>*</b>' : kind === 'income' ? 'Where did the money go? <b>*</b>' : 'Which account did the money leave? <b>*</b>';
    const accountSelect = $('#txAccount');
    const selected = accountSelect.value;
    accountSelect.innerHTML = data.accounts.map(a => `<option value=\"${esc(a.id)}\">${esc(a.name)} · ${esc(accountTypeLabel(a.type))}</option>`).join('');
    if (data.accounts.some(a => a.id === selected)) accountSelect.value = selected;
    const dest = $('#txDestination');
    const oldDest = dest.value;
    dest.innerHTML = data.accounts.map(a => `<option value=\"${esc(a.id)}\">${esc(a.name)} · ${esc(accountTypeLabel(a.type))}</option>`).join('');
    if (data.accounts.some(a => a.id === oldDest)) dest.value = oldDest;
    else if (data.accounts.length > 1) dest.selectedIndex = 1;
    const categories = kind === 'income' ? categoriesFor('income') : categoriesFor('expense');
    const categorySelect = $('#txCategory');
    const oldCategory = categorySelect.value;
    categorySelect.innerHTML = categories.map(c => `<option value=\"${esc(c)}\">${esc(c)}</option>`).join('');
    if (categories.includes(oldCategory)) categorySelect.value = oldCategory;
    $('#transactionError').classList.add('hidden');
  }
  function updateEvidenceNoteLabel() {
    const type = $('input[name=\"evidenceType\"]:checked')?.value || 'none';
    $('#evidenceNoteLabel').innerHTML = type === 'paper' ? 'Receipt note / number <small>Optional</small>' : type === 'digital' ? 'Confirmation / reference <small>Optional</small>' : 'Note / reference <small>Optional</small>';
    $('#txEvidenceNote').placeholder = type === 'paper' ? 'e.g. store name or receipt number' : type === 'digital' ? 'e.g. confirmation ID or e-wallet reference' : 'e.g. merchant or anything to remember';
  }
  function saveTransaction(ev) {
    ev.preventDefault();
    const kind = $('#txKind').value;
    const amount = Number($('#txAmount').value);
    const tx = {
      id: newId('tx'), kind, amount, date: $('#txDate').value,
      note: $('#txNote').value.trim(), evidenceType: $('input[name=\"evidenceType\"]:checked')?.value || 'none',
      evidenceNote: $('#txEvidenceNote').value.trim(), createdAt: new Date().toISOString()
    };
    if (kind === 'transfer') { tx.fromAccountId = $('#txAccount').value; tx.toAccountId = $('#txDestination').value; }
    else { tx.accountId = $('#txAccount').value; tx.category = $('#txCategory').value; }
    const errors = L.validateTransaction(tx, data.accounts);
    if (errors.length) { $('#transactionError').textContent = errors.join(' '); $('#transactionError').classList.remove('hidden'); return; }
    if (kind === 'transfer' && tx.fromAccountId === tx.toAccountId) { $('#transactionError').textContent = 'Choose two different accounts.'; $('#transactionError').classList.remove('hidden'); return; }
    if (kind === 'expense' && data.accounts.find(a => a.id === tx.accountId)?.type !== 'credit' && amount > (L.accountBalance(data.accounts.find(a => a.id === tx.accountId), data.transactions) + 0.001)) {
      const ok = window.confirm('This expense is larger than the tracked balance for this account. Record it anyway? The balance may become negative until you reconcile it.');
      if (!ok) return;
    }
    if (kind === 'transfer') {
      const source = data.accounts.find(a => a.id === tx.fromAccountId);
      const current = L.accountBalance(source, data.transactions);
      if (source?.type !== 'credit' && amount > current + 0.001 && !window.confirm('This transfer is larger than the tracked balance in the source account. Record it anyway?')) return;
      const destination = data.accounts.find(a => a.id === tx.toAccountId);
      if (destination?.type === 'credit' && amount > L.accountBalance(destination, data.transactions) + 0.001 && !window.confirm('This payment is greater than the tracked credit-card debt. Record it anyway?')) return;
    }
    data.transactions.push(tx);
    saveData(); closeModal('transactionModal'); renderAll(); showToast('Transaction recorded. Your overview is updated.');
  }
  function openAccountModal() {
    activeAccountEditId = null;
    $('#accountForm').reset();
    $('#accountModalTitle').textContent = 'Add an account';
    $('#openingBalance').value = '0';
    $('#accountStartDate').value = L.localISODate();
    $('#accountType').disabled = false;
    $('#openingBalanceLabel').innerHTML = 'Starting balance (₱) <b>*</b>';
    updateOpeningHelp();
    $('#accountError').classList.add('hidden');
    openModal('accountModal');
  }
  function updateOpeningHelp() {
    const credit = $('#accountType').value === 'credit';
    $('#openingBalanceLabel').innerHTML = credit ? 'Starting amount owed (₱) <b>*</b>' : 'Starting balance (₱) <b>*</b>';
    $('#openingBalanceHelp').textContent = credit ? 'Enter the card debt at the beginning of your tracking date, as a positive amount.' : 'Enter the balance at the beginning of your tracking date. Record transactions on or after that date.';
  }
  function saveAccount(ev) {
    ev.preventDefault();
    const name = $('#accountName').value.trim();
    const type = $('#accountType').value;
    const openingBalance = Number($('#openingBalance').value);
    const openingDate = $('#accountStartDate').value;
    if (!name) { $('#accountError').textContent = 'Enter an account name.'; $('#accountError').classList.remove('hidden'); return; }
    if (!Number.isFinite(openingBalance) || openingBalance < 0) { $('#accountError').textContent = 'Enter a valid starting balance of zero or more.'; $('#accountError').classList.remove('hidden'); return; }
    if (!L.isValidISODate(openingDate) || openingDate > L.localISODate()) { $('#accountError').textContent = 'Choose a valid tracking start date that is today or earlier.'; $('#accountError').classList.remove('hidden'); return; }
    if (data.accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) { $('#accountError').textContent = 'An account with that name already exists. Use a name that distinguishes it.'; $('#accountError').classList.remove('hidden'); return; }
    data.accounts.push({ id: newId('acc'), name, type, openingBalance: L.roundMoney(openingBalance), openingDate, createdAt: new Date().toISOString() });
    saveData(); closeModal('accountModal'); renderAll(); showToast('Account added. Record activity to keep its balance current.');
  }
  function deleteTransaction(txId) {
    const tx = data.transactions.find(t => t.id === txId);
    if (!tx) return;
    if (!window.confirm(`Delete “${txTitle(tx)}” for ${money(tx.amount)}? This will recalculate the affected account balances and budgets.`)) return;
    data.transactions = data.transactions.filter(t => t.id !== txId);
    saveData(); renderAll(); showToast('Transaction deleted and balances recalculated.');
  }
  function deleteAccount(accountId) {
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;
    const related = data.transactions.filter(t => t.accountId === accountId || t.fromAccountId === accountId || t.toAccountId === accountId).length;
    if (related) { showToast('This account has transaction history. Delete those records first to preserve ledger accuracy.', 'error'); return; }
    if (!window.confirm(`Remove account “${account.name}”?`)) return;
    data.accounts = data.accounts.filter(a => a.id !== accountId);
    saveData(); renderAll(); showToast('Account removed.');
  }
  function reconcileAccount(accountId) {
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) return;
    activeReconcileAccountId = accountId;
    const current = L.accountBalance(account, data.transactions);
    $('#reconcileAccountDescription').textContent = `Check ${account.name}. Enter the balance currently shown in your ${account.type === 'credit' ? 'credit-card app (amount owed)' : 'bank or wallet'}.`;
    $('#reconcileCalculated').textContent = money(current);
    $('#reconcileActualLabel').innerHTML = `${account.type === 'credit' ? 'Outstanding amount owed (₱)' : 'Balance shown by bank / wallet (₱)'} <b>*</b>`;
    $('#reconcileActual').value = current.toFixed(2);
    $('#reconcileReason').value = '';
    $('#reconcileError').classList.add('hidden');
    openModal('reconcileModal');
    $('#reconcileActual').select();
  }
  function saveReconciliation(ev) {
    ev.preventDefault();
    const accountId = activeReconcileAccountId;
    const account = data.accounts.find(a => a.id === accountId);
    const actual = Number($('#reconcileActual').value);
    if (!account || !Number.isFinite(actual) || actual < 0) {
      $('#reconcileError').textContent = 'Enter a valid balance of zero or more.';
      $('#reconcileError').classList.remove('hidden');
      return;
    }
    const current = L.accountBalance(account, data.transactions);
    const delta = L.roundMoney(actual - current);
    if (Math.abs(delta) < 0.005) {
      closeModal('reconcileModal');
      showToast('Balances match. Nice work keeping your records current.');
      return;
    }
    const reason = $('#reconcileReason').value.trim();
    data.transactions.push({ id: newId('adj'), kind: 'adjustment', amount: Math.abs(delta), delta, accountId, category: 'Reconciliation', note: reason || 'Balance reconciliation', evidenceType: 'none', evidenceNote: '', date: L.localISODate(), createdAt: new Date().toISOString() });
    saveData(); closeModal('reconcileModal'); renderAll(); showToast('Balance confirmed. The adjustment is recorded in your activity history.');
  }
  function openBudgetEditor(prefillCategory = '') {
    const cats = [...new Set([...Object.keys(data.budgets), ...(data.customCategories || [])])].sort((a,b)=>a.localeCompare(b));
    $('#budgetEditorRows').innerHTML = cats.map(category => `<label class=\"budget-editor-row\"><span>${esc(category)}</span><span class=\"budget-editor-input\"><small>₱</small><input type=\"number\" min=\"0\" step=\"1\" inputmode=\"decimal\" data-budget-category=\"${esc(category)}\" value=\"${Number(data.budgets[category] || 0)}\" aria-label=\"${esc(category)} monthly budget\" /></span></label>`).join('');
    $('#budgetError').classList.add('hidden');
    openModal('budgetModal');
    if (prefillCategory) { const input = $(`[data-budget-category=\"${CSS.escape(prefillCategory)}\"]`); if (input) { input.focus(); input.select(); } }
  }
  function saveBudget(ev) {
    ev.preventDefault();
    const next = { ...data.budgets };
    for (const input of $$('[data-budget-category]', $('#budgetEditorRows'))) {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0) { $('#budgetError').textContent = 'Budget amounts must be zero or greater.'; $('#budgetError').classList.remove('hidden'); return; }
      next[input.dataset.budgetCategory] = L.roundMoney(value);
    }
    data.budgets = next;
    saveData(); closeModal('budgetModal'); renderAll(); showToast('Budget limits saved.');
  }
  function addBudgetCategory() {
    const name = window.prompt('Name your budget category (for example, Pet care or Family support):');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed.length > 50) { showToast('Category names must be 50 characters or fewer.', 'error'); return; }
    if ([...Object.keys(data.budgets), ...(data.customCategories || [])].some(c => c.toLowerCase() === trimmed.toLowerCase())) { showToast('That category already exists.', 'error'); return; }
    data.customCategories = [...(data.customCategories || []), trimmed];
    data.budgets[trimmed] = 0;
    saveData(); renderAll(); openBudgetEditor(trimmed); showToast('Category added. Set a monthly limit if useful.');
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
  }

  function exportCSV() {
    const header = ['date','type','amount_php','category','account','from_account','to_account','note','record_type','record_reference'];
    const map = accountMap();
    const rows = [header, ...[...data.transactions].sort((a,b)=>a.date.localeCompare(b.date)).map(tx => [
      tx.date, tx.kind, tx.kind === 'adjustment' ? tx.delta : tx.amount, tx.category || '', tx.accountId ? map[tx.accountId]?.name || '' : '',
      tx.fromAccountId ? map[tx.fromAccountId]?.name || '' : '', tx.toAccountId ? map[tx.toAccountId]?.name || '' : '', tx.note || '', tx.evidenceType || 'none', tx.evidenceNote || ''
    ])];
    const csv = rows.map(row => row.map(cell => {
      let value = String(cell ?? '');
      // Reduce spreadsheet formula-injection risk in user-provided text fields.
      if (typeof cell === 'string' && /^[\s]*[=+\-@]/.test(value)) value = "'" + value;
      return `\"${value.replace(/\"/g, '\"\"')}\"`;
    }).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `xpense-transactions-${L.localISODate()}.csv`);
    showToast('Transaction CSV exported. Keep the file somewhere private.');
  }
  function startFresh() {
    const message = data.demo ? 'Clear the sample workspace and start with your own accounts? The sample data will be removed from this browser.' : 'Reset this workspace? All accounts, transactions and budget limits will be cleared from this browser.';
    if (!window.confirm(message)) return;
    data = freshData(); saveData(true); switchView('accounts'); renderAll(); openAccountModal(); showToast('Your personal workspace is ready. Add your first account.');
  }
  function resetDemo() {
    if (!window.confirm('Replace this workspace with the Xpense sample data? Current local entries will be removed. Export your CSV first if you need to keep them.')) return;
    data = createDemoData(); saveData(true); activeView = 'overview'; renderAll(); showToast('Sample workspace restored.');
  }

  // Top-level navigation and shared actions
  $$('.nav-item[data-view], .mobile-nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $$('[data-view-link]').forEach(btn => btn.addEventListener('click', ev => { ev.preventDefault(); switchView(btn.dataset.viewLink); }));
  $$('[data-view]').forEach(btn => { if (!btn.classList.contains('nav-item') && !btn.classList.contains('mobile-nav-item')) btn.addEventListener('click', () => switchView(btn.dataset.view)); });
  ['#quickAddTop', '#quickAddOverview', '#mobileQuickAdd'].forEach(id => $(id).addEventListener('click', () => openTransactionModal('expense')));
  document.addEventListener('click', ev => {
    const openAdd = ev.target.closest('[data-open-add]');
    if (openAdd) { ev.preventDefault(); openTransactionModal('expense'); }
    if (ev.target.closest('#emptyAddAccount')) { openAccountModal(); }
    const close = ev.target.closest('[data-close-modal]');
    if (close) { closeModal(close.closest('.modal-overlay')); }
    const editBudget = ev.target.closest('[data-edit-budget]');
    if (editBudget) openBudgetEditor(editBudget.dataset.editBudget);
    const rec = ev.target.closest('[data-reconcile-account]');
    if (rec) reconcileAccount(rec.dataset.reconcileAccount);
    const delTx = ev.target.closest('[data-delete-tx]');
    if (delTx) deleteTransaction(delTx.dataset.deleteTx);
    const delAcc = ev.target.closest('[data-delete-account]');
    if (delAcc) deleteAccount(delAcc.dataset.deleteAccount);
  });
  $$('.modal-overlay').forEach(overlay => overlay.addEventListener('click', ev => { if (ev.target === overlay) closeModal(overlay); }));
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') $$('.modal-overlay:not(.hidden)').forEach(closeModal); });
  $$('.kind-option').forEach(btn => btn.addEventListener('click', () => setTransactionKind(btn.dataset.kind)));
  $$('input[name=\"evidenceType\"]').forEach(r => r.addEventListener('change', updateEvidenceNoteLabel));
  $('#transactionForm').addEventListener('submit', saveTransaction);
  $('#accountForm').addEventListener('submit', saveAccount);
  $('#accountType').addEventListener('change', updateOpeningHelp);
  $('#addAccountBtn').addEventListener('click', openAccountModal);
  $('#manageBudgetBtn').addEventListener('click', () => openBudgetEditor());
  $('#addBudgetCategoryBtn').addEventListener('click', addBudgetCategory);
  $('#budgetForm').addEventListener('submit', saveBudget);
  $('#reconcileForm').addEventListener('submit', saveReconciliation);
  $('#activitySearch').addEventListener('input', renderActivity);
  $('#activityFilter').addEventListener('change', renderActivity);
  $('#activityMonth').addEventListener('change', renderActivity);
  $('#exportCsvBtn').addEventListener('click', exportCSV);
  $('#startFreshBtn').addEventListener('click', startFresh);
  $('#useOwnDataBtn').addEventListener('click', startFresh);
  $('#resetDemoBtn').addEventListener('click', resetDemo);

  data = loadData();
  renderAll();
})();
