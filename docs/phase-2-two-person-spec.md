# Xpense Phase 2 — Two-person household specification

## Goal

Let two people maintain their own private finances while collaborating on a shared household budget. The household is a distinct budgeting workspace, not permission to browse a partner's personal accounts.

## Product boundary

- Each person has their own authenticated account and profile. The household stores a separate display alias for shared attribution; the partner's private profile row is not exposed.
- Personal accounts, opening balances, transaction history, income, debts, private budgets, notes, and evidence references remain visible only to their owner.
- The household workspace contains only entries deliberately recorded as shared, household categories, household monthly limits, contributions, refunds, and member attribution.
- The household has one owner and one member maximum in this release. Invitation acceptance is single-use, expires after seven days, and must match the verified email of the signed-in user.
- Either active member may record, view, edit, or delete ordinary household entries and manage household categories and budget limits.
- The owner may create/revoke the current invite, rename/delete the household, and remove the member. Each person can edit their own household display alias. The member may leave. Ownership transfer and owner self-removal are deferred; deleting the household permanently removes its shared data.
- No bank APIs, paid notification service, receipt-file storage, OCR, or paid analytics are required for this scope.

## Ledger and budget semantics

Personal and household ledgers are separate domains. A household entry affects household budget progress only; it does not change a personal account balance, net worth, personal income total, or personal expense total. A member who wants an expense reflected in personal account balances must also record the corresponding personal transaction. Phase 2 UI should make the distinction explicit and offer a one-step paired workflow only after an atomic database operation and private linkage have been implemented. Never count a household entry twice in one metric.

A household expense or refund has a household category and a member responsible for the payment/receipt. A contribution has no spending category and identifies the contributing member. An entry includes amount, date, short note, and optional paper/digital evidence reference. Evidence references are text only; actual files are out of scope.

A budget limit repeats monthly. The household overview shows the current month's category totals and remaining/overrun amounts. Contributions are shown separately and must not be treated as income earned by either member. Household budget values are plans, not proof that the household physically holds that amount in cash.

## Authentication and invitations

1. A user creates an account and confirms their email.
2. They create a named household. The database creates the owner membership atomically.
3. The owner enters the other person's email and creates a single-use invite link.
4. The raw invitation token is returned once for a shareable link; only its SHA-256 hash is persisted. Link tokens should be kept in the URL fragment, not query parameters, to avoid routine server logs.
5. The invited person signs in with a verified matching email and accepts the invitation. The database serializes acceptance against invite creation and enforces the two-active-member limit.
6. The app must not expose the invitation table through the client API. Only the constrained RPC functions may access it.

No custom email sender is required initially; the owner can copy/share the invite link themselves. Email confirmation still depends on the Auth provider configuration and its limits.

## Release sequence

### Phase 2A — Authentication and household lifecycle
- Sign-up/sign-in/sign-out and session handling.
- Create household, copy/share invitation link, accept invite, revoke/reissue invite.
- Enforce two active members server-side; allow member exit and owner removal.
- Owner can delete the household with an explicit irreversible confirmation.

### Phase 2B — Cloud-backed private finance
- Connect existing private accounts, categories, transactions and budgets to Supabase.
- Migrate no browser data silently: export/import must be explicit and validated.
- Preserve account balance, card debt, transfer and reconciliation semantics from Phase 1.
- Add personal CSV export and a safe sign-out/device-sharing experience.

### Phase 2C — Shared budget and ledger
- Shared categories, monthly budgets, entries, contributions, refunds and payer/recorder attribution.
- Clearly label private vs shared spaces on every transaction form.
- Avoid accidental household posting from personal expenses.
- Do not expose the private source transaction row to a household member. If a future single-step personal-plus-household recording flow is added, use a transaction-safe server operation and private association table.

### Phase 2D — Privacy and recovery tests
- Verify user A cannot read, update, delete, or infer row content from user B's private records.
- Verify a non-member cannot enumerate a household, memberships, invite records, budgets or entries.
- Verify a member can access only the household they joined and cannot create a third active member.
- Verify an invite is rejected when expired, revoked, reused, or accepted using a different/unverified email.
- Verify a removed/left member loses access immediately while historical household entries retain attribution.
- Verify household entries never affect private account balances or personal totals.
- Test CSV export, recovery, and deletion behavior before entering real financial records.

## Not yet implemented

This specification and the additive SQL migration describe the target backend. The current browser app still uses localStorage. The migration has not been applied to a Supabase project, authentication is not yet wired into the frontend, and no real user records should be entered under the assumption of cloud backup.
