# Xpense — privacy and permission model

## Data scopes

| Data | Scope | Who may read it |
|---|---|---|
| Profile | User | That user |
| Accounts and balances | User | That user |
| Personal transactions, notes and evidence references | User | That user |
| Personal categories and budgets | User | That user |
| Household name, active membership roster, and household display aliases | Household | Active members |
| Household categories and monthly budgets | Household | Active members |
| Household entries, contributions and refunds | Household | Active members |
| Invitation token hashes and invitation metadata | Internal | Constrained server-side database functions only |

Household membership never grants access to personal data. The existing owner-only RLS policies on personal tables are left intact by the Phase 2 migration.

## Roles

**Owner:** creates the household, issues/revokes the invite, renames or deletes the household, and removes the member. In the first version the owner cannot leave or transfer ownership.

**Member:** accepts the invite, can manage normal shared entries/categories/budgets, and can leave the household. They cannot remove the owner or invite a third person.

Both roles can create, read, edit, and delete ordinary household budget entries. Entry creator attribution is immutable; the latest editor is tracked separately. Each user can change their own household display alias without exposing their private profile row.

## Database enforcement

- RLS is enabled on every new public household table.
- Household reads/writes require active membership, enforced in database policies rather than UI visibility.
- Private helper functions use a fixed empty search path and return only membership/role checks to the caller.
- Household creation and invite acceptance are RPC operations. Direct client writes to membership and invitation tables are not granted.
- Invitation acceptance requires a verified Auth email match, a valid unexpired unused token, and available space in the two-member household.
- Invite tokens are random, single-use, valid for seven days, and only SHA-256 hashes are stored. The invitation table has no client grants or client RLS policies.
- The household row is locked while accepting an invitation so concurrent accepts cannot overfill the household.
- Private accounts and transactions remain in the existing user-owned tables; no RLS policy is broadened to include household members.
- Never place a service-role or secret key in frontend code.

## Known boundaries

The shared household ledger is a budgeting layer, not a cash account. Adding a household entry does not change a member's private account balance. The current schema intentionally has no public link from a shared entry to a private transaction. A future one-step pairing flow must write both records atomically and store any cross-reference in a non-exposed private table; it must never expose the partner's source transaction or private account ID.

This migration still needs a disposable-project apply test, Supabase security advisor review, and two-user RLS/API tests. Static CI checks are not a substitute for those tests.
