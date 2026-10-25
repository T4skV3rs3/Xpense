const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('account creation uses shared calendar-aware date validation', () => {
  assert.ok(app.includes('L.isValidISODate(openingDate)'));
  assert.ok(!app.includes('!/^\\\\d{4}-\\\\d{2}-\\\\d{2}$/.test(openingDate)'));
});

test('CSV export uses row breaks and guards formula prefixes', () => {
  assert.match(app, /join\('\\r\\n'\)/);
  assert.match(app, /\^\[\\s\]\*\[=\+\\-@\]/);
});

test('persistence failures cannot be reported as success and unreadable stored data is protected', () => {
  assert.ok(app.includes('pendingStorageWarning'));
  assert.ok(app.includes('storageRecoveryBlocked'));
  assert.ok(app.includes('left it untouched'));
  assert.ok(html.includes('id="storageWarning"'));
});

test('full backup and restore controls are present and wired', () => {
  for (const id of ['exportBackupBtn', 'importBackupBtn', 'importBackupFile']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing control: ' + id);
  }
  assert.ok(app.includes('function validateBackupPayload'));
  assert.ok(app.includes('function exportFullBackup'));
  assert.ok(app.includes('function importFullBackup'));
});


test('custom budget categories are not offered as income categories', () => {
  assert.ok(app.includes("if (kind === 'income') return [...L.INCOME_CATEGORIES]"));
  assert.ok(app.includes("...L.EXPENSE_CATEGORIES, ...(data.customCategories || [])"));
});

test('accounts have an edit action and lock ledger-defining fields once history exists', () => {
  assert.ok(html.includes('data-edit-account='));
  assert.ok(app.includes('function openAccountModal(accountId = null)'));
  assert.ok(app.includes("$('#accountType').disabled = hasHistory"));
  assert.ok(app.includes("$('#openingBalance').disabled = hasHistory"));
  assert.ok(app.includes("$('#accountStartDate').disabled = hasHistory"));
});
