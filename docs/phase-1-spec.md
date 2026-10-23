# Xpense Phase 1 — Product and Acceptance Specification

## Product objective

Make day-to-day money tracking easy enough to maintain. The user describes a real money event in plain terms; Xpense updates the financial picture using one consistent transaction ledger.

## Target first release

Personal use for Philippine users who want to track cash, bank accounts, e-wallets, credit cards, spending and category budgets manually. Currency display is PHP. The UI is designed for desktop and mobile.

## Primary user journey

1. Start with a sample workspace or clear the sample data.
2. Add each account and provide a starting balance and tracking-start date.
3. Record a transaction: expense, income or transfer/payment.
4. Optionally label the record as a quick note, paper receipt or digital confirmation, then add a reference note.
5. See the resulting balance, budget, activity history and overall financial snapshot update.
6. Periodically compare a calculated account balance with the bank/wallet/card app and confirm a reconciliation adjustment if needed.

## Functional requirements

- Overview: tracked assets, recorded monthly expenses/income, estimated net worth, six-month income/expense comparison, category-budget snapshot and recent activity.
- Activity: transaction search, type/month filters, record type/reference, delete-with-confirmation, CSV export.
- Budget: monthly category limits, category spent/remaining/overrun and custom categories.
- Accounts: account names/types, starting amounts/date, computed balances, tracked credit-card debt, reconciliation and account removal only when unreferenced.
- Transaction capture: amount, account or transfer endpoints, date, category, short note and optional receipt type/reference.
- Validation: amount greater than zero, no same-account transfers, no future-dated completed transactions, no account activity before tracking start, no ordinary income posted to a credit card, and warnings for spending/transfers larger than tracked balances.
- Persistence: local browser storage with a CSV export path. No external data transmission.

## Non-goals for Phase 1

- Bank, debit-card, credit-card or e-wallet APIs.
- Account login, remote database, cloud backup or cross-device sync.
- Actual receipt/photo/PDF storage or OCR.
- Recurring bills, subscription reminders, shared households, investment transactions or advice.
- Taxes, interest accrual, automatic credit-card-statement reconciliation or multi-currency accounting.

## Money semantics / definitions

- Assets: cash, bank accounts and e-wallets, represented as positive money held.
- Credit-card account: positive balance means debt owed.
- Net worth: sum of tracked asset balances minus tracked credit-card balances.
- Expense: reduces an asset or increases credit-card debt; included in spending and budget totals.
- Income: increases an asset balance. A transaction categorized as Refund is excluded from income metrics but currently does not reduce its original spending category.
- Transfer: moves value between accounts; excluded from income and expenses. Asset-to-card transfer is a card payment and reduces debt; card-to-asset transfer is modelled as a cash advance.
- Reconciliation adjustment: changes the computed account balance with an explicit dated entry; excluded from income and spending.
- Starting balance: baseline at the beginning of that account's tracking-start date. Only transactions on or after that date affect its computed balance.

## Acceptance criteria

- A new account can be created and shown on Accounts.
- Recording an asset expense decreases that account's balance and increases category spending.
- Recording a credit-card purchase increases card debt and counts as one expense.
- Paying a credit card from a bank account decreases both balances (cash and debt) but adds no second expense.
- Transferring between two asset accounts does not change total tracked assets/net worth and isn't counted as spending or income.
- Updating a budget limit updates progress in Budget and Overview.
- A reconciliation difference creates a visible adjustment entry and recalculates the selected account.
- Reloading the same browser preserves local data.
- Export produces a CSV of transaction data.
