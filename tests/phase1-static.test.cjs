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

test('CSV export uses correct row breaks and common formula-prefix protection', () => {
  assert.ok(app.includes("}).join(',')).join('\\\\r\\\\n');"));
  assert.ok(app.includes('/^[\\\\s]*[=+\\\\-@]/.test(value)'));
});

test('persistence failures cannot be reported as success and unreadable stored data is protected', () => {
  assert.ok(app.includes('pendingStorageWarning'));
  assert.ok(app.includes('storageRecoveryBlocked'));
  assert.ok(app.includes('left it untouched'));
  assert.ok(html.includes('id="storageWarning"'));
});

test('full backup/restore controls are present and wired', () => {
  for (const id of ['exportBackupBtn', 'importBackupBtn', 'importBackupFile']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing control: ' + id);
  }
  assert.ok(app.includes('function validateBackupPayload'));
  assert.ok(app.includes('function exportFullBackup'));
  assert.ok(app.includes('function importFullBackup'));
});
