# Xpense — Phase 1 MVP

**A manual-first personal expense, finance, and budget tracker designed for Philippine users.**

Xpense helps people record money events quickly, understand how those records affect their accounts, and view one consolidated financial picture. The first release deliberately uses manual tracking rather than bank linking: the user records what happened, and Xpense handles the calculations.

## Phase 1 features

- **Overview:** tracked assets, monthly recorded income and expenses, tracked net worth, a six-month cash-flow chart, category budget progress, and recent activity.
- **Quick Record:** record an expense, income, or transfer/payment with amount, account, category, date, short note, and optional paper-receipt/digital-record reference.
- **Accounts:** manually track cash, bank accounts, e-wallets, and credit cards. Balances are calculated from opening amounts and transaction history.
- **Budget:** set category limits and review amounts spent, remaining, and over budget.
- **Activity:** search and filter transactions, delete with confirmation, and export transactions to CSV.
- **Balance Check:** compare a manually tracked balance to the current figure shown by the bank/wallet/card app. Discrepancies become explicit reconciliation entries.
- **Accounting safeguards:** transfers between owned accounts are not income or expenses; credit-card purchases create one expense and increase card debt; paying a credit card reduces cash and debt without counting the purchase twice.
- **Responsive design:** supports desktop and mobile layouts.

## Run locally

Requires Python 3 or Node.js 18+ for the included tests. No runtime packages are required.

Option A — from the repository root:

    python3 -m http.server 8000

Open http://localhost:8000 in your browser.

Option B — check financial calculations:

    npm test
    node --check src/ledger.js
    node --check src/app.js

## Local data and backups

- The app currently stores data in this browser's localStorage using the key xpense-phase1-v1.
- Local browser storage is **not** a reliable backup and does not sync across browsers or devices.
- Use Activity → Export CSV to make an extra transaction backup and store it somewhere private.
- This MVP does not connect to BDO, UnionBank, GCash, or any bank/payment account. Do not enter bank credentials, PINs, CVVs, or one-time passwords into Xpense.
- The receipt selector currently stores a record type and a text reference only. It does not upload or retain actual receipt images or PDFs.

## Scope boundaries

Phase 1 is a prototype foundation, not a production-ready financial-data service. Authentication, multi-user access, server-side storage, cross-device sync, automated cloud backups, bank integrations, recurring bills, and actual receipt file uploads are not implemented yet.

Before real users' financial information is stored in the cloud, add secure authentication, per-user authorization, database row-level security, input validation, backup/restore procedures, deletion/export controls, privacy notices, and a security review.

## Project structure

    .
    ├── index.html
    ├── package.json
    ├── src/
    │   ├── app.js
    │   ├── ledger.js
    │   └── styles.css
    ├── tests/
    │   └── ledger.test.cjs
    └── docs/
        ├── data-model.md
        └── phase-1-spec.md

## License

See LICENSE in this repository.
