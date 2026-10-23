# Xpense Phase 1 — Data Model

The current prototype stores one versioned object in browser `localStorage` under `xpense-phase1-v1`.

```js
{
  version: 1,
  demo: true,
  accounts: [
    {
      id: "acc-example",
      name: "GCash wallet",
      type: "ewallet", // cash | bank | ewallet | credit
      openingBalance: 1000,
      openingDate: "2026-10-23",
      createdAt: "ISO timestamp"
    }
  ],
  transactions: [
    {
      id: "tx-example",
      kind: "expense", // expense | income | transfer | adjustment
      amount: 185,
      date: "2026-10-23",
      accountId: "acc-example",
      category: "Food & drinks",
      note: "Lunch",
      evidenceType: "digital", // none | paper | digital
      evidenceNote: "Optional confirmation reference",
      createdAt: "ISO timestamp"
    }
  ],
  budgets: { "Food & drinks": 3500 },
  customCategories: []
}
```

Transfers use `fromAccountId` and `toAccountId` instead of `accountId`. Reconciliation entries use `kind: "adjustment"`, `accountId`, signed `delta`, positive `amount` (absolute delta), and a reason in `note`.

## Invariants

1. IDs are stable transaction/account identifiers.
2. Amount is positive; reconciliation direction is carried by signed `delta`.
3. Asset balances are positive money held; credit-card balances are positive debt.
4. Account balances derive from `openingBalance` plus in-scope ledger effects; stored balances are never independently mutated.
5. The opening baseline applies at the beginning of `openingDate`; earlier transactions are ignored by that account and rejected in UI validation.
6. Expense only affects one account and counts once. Transfer affects two accounts but is excluded from income/expense totals.
7. Reconciliation records are auditable transactions, not silent edits to the opening balance.
8. User-provided strings are escaped before HTML rendering; CSV text that starts with common spreadsheet formula characters is prefixed to reduce formula-injection risk.

## Upgrade path (not implemented)

Future multi-user/cloud versions should migrate these objects into authenticated server-side tables (for example, `profiles`, `accounts`, `transactions`, `budgets`, `categories`, and later `attachments`) with strict ownership policies, server-side validation, backups, deletion/export workflows and a security review. Do not directly expose this local prototype's data model as a production financial API.

## Phase 2 data boundary (planned; not yet connected)

The new household migration deliberately leaves the Phase 1 tables and owner-only RLS policies unchanged. It adds separate household tables for memberships, categories, monthly budgets, and shared budget entries. The invitation table has RLS enabled but no client grants; constrained database functions create and consume invitations.

Household entries are budget projections and do not modify private account balances, personal net worth, or personal income/expense totals. A future one-step personal-plus-household entry flow must perform both writes atomically and keep any cross-reference in a non-exposed private schema. Do not loosen the personal policies to make shared entries work.

See docs/phase-2-two-person-spec.md and docs/permissions-model.md for behavior and acceptance tests. Migration not applied; RLS/API integration tests remain required.
