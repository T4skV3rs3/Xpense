const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261024120000_two_person_households.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

test('every new public household table has RLS enabled', () => {
  const tables = [
    'households',
    'household_members',
    'household_invitations',
    'household_categories',
    'household_budgets',
    'household_entries'
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp('create table if not exists public\\.' + table + '\\b', 'i'), table + ' table exists');
    assert.match(sql, new RegExp('alter table public\\.' + table + ' enable row level security', 'i'), table + ' has RLS');
  }
});

test('household membership has a shared display alias without exposing private profile data', () => {
  assert.match(sql, /display_name text not null check \(char_length\(trim\(display_name\)\) between 1 and 80\)/i);
  assert.match(sql, /set_xpense_household_display_name\(\s*p_household_id uuid,\s*p_display_name text\)/i);
  assert.match(sql, /revoke all on function public\.set_xpense_household_display_name\(uuid, text\) from public, anon, authenticated/i);
});

test('membership and invitation records cannot be written directly by client roles', () => {
  assert.match(sql, /revoke all on public\.households, public\.household_members, public\.household_invitations,[\s\S]*?from public, anon, authenticated/i);
  assert.match(sql, /grant select on public\.household_members to authenticated/i);
  assert.match(sql, /invitations have RLS enabled but intentionally have no client policies or client grants/i);
  assert.doesNotMatch(sql, /create policy[^;]+on public\.household_invitations/i);
});

test('household creation, invite acceptance, leaving, and removal are explicit RPC operations', () => {
  for (const signature of [
    'public.create_xpense_household(text)',
    'public.create_household_invitation(uuid, text)',
    'public.accept_household_invitation(text)',
    'public.leave_xpense_household(uuid)',
    'public.remove_xpense_household_member(uuid, uuid)',
    'public.set_xpense_household_display_name(uuid, text)'
  ]) {
    assert.ok(sql.includes(signature), 'missing function ' + signature);
    assert.ok(sql.toLowerCase().includes('grant execute on function ' + signature.toLowerCase() + ' to authenticated'), 'function not granted to authenticated: ' + signature);
  }
});

test('invitation flow hashes tokens and verifies confirmed matching email', () => {
  assert.match(sql, /extensions\.gen_random_bytes\(32\)/i);
  assert.match(sql, /extensions\.digest\(v_token, 'sha256'\)/i);
  assert.match(sql, /extensions\.digest\(lower\(p_token\), 'sha256'\)/i);
  assert.match(sql, /v_email_confirmed_at is null/i);
  assert.match(sql, /lower\(v_invitation\.invitee_email\) <> v_email/i);
  assert.match(sql, /if v_active_members >= 2 then/i);
});

test('the household ledger does not directly rewrite personal accounts or transactions', () => {
  assert.match(sql, /Shared household budget ledger only/i);
  assert.doesNotMatch(sql, /create policy[^;]+on public\.transactions[^;]*household/i);
});
