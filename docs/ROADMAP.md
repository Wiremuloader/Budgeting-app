# Roadmap and status

Last updated: 2026-10-16.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Foundations: scaffold, schema + migrations, financial domain engine, auth | ✅ Done |
| 2 | Design system & shell: tokens, light/dark, sidebar + mobile bottom nav, primitives, charts | ✅ Done |
| 3 | Accounts & transactions: CRUD, splits, transfers, refunds, pending, filters, search, sort, pagination, bulk edit, history, merchant rules | ✅ Done |
| 4 | Budgets (envelope + flexible), categories, onboarding + starter budget | ✅ Done |
| 5 | Recurring + subscription detection, goals + scenarios, debt + avalanche/snowball | ✅ Done |
| 6 | Overview dashboard, insights, forecasting (7/30/90), reports, CSV import/export | ✅ Done |
| 7 | Notifications (in-app + email channel), assistant (AI + direct mode), banking abstraction | ✅ Done (no live bank provider — see gaps) |
| 8 | Hardening: security review, a11y pass, tests, docs, Docker | ✅ Done, with gaps below |

## Definition of done — checklist

| Requirement | Status | Evidence |
|---|---|---|
| Register, sign in, onboarding | ✅ | e2e `sign up, complete onboarding…`, `wrong password is rejected`; integration `auth.test.ts` |
| Create accounts; add/edit/categorise transactions | ✅ | e2e `add, edit, split and delete…`; integration `ledger.test.ts` |
| Dashboard reflects persisted data | ✅ | Overview built only from services; integration `builds the overview from persisted data` |
| Functional budgets | ✅ | integration envelope/flexible tests; e2e budget assign |
| Refunds, transfers, splits correct | ✅ | unit `ledger.test.ts`; integration; e2e `transfers are not spending` |
| Goals & debt projections tested | ✅ | unit `debt-goals.test.ts`; integration; e2e |
| CSV import/export with documented formats | ✅ | `docs/CSV_FORMATS.md`; unit + integration + e2e |
| Reports & charts respond to data and date filters | ✅ | Reports page filters drive every query; tables mirror charts |
| Assistant uses verified calculations | ✅ | Read-only tools over services; integration `assistant tools validate input…` |
| Desktop and mobile | ✅ | e2e `mobile layout uses the bottom navigation`; manual checks at 320–1440 px |
| User data isolation | ✅ | integration `user data isolation`; e2e `users can't see each other's data` |
| Critical financial logic covered | ✅ | 102 unit + 37 integration tests |
| Production build succeeds | ✅ | `npm run build` |
| Setup and deployment docs | ✅ | README, `docs/DEPLOYMENT.md`. Docker files written but **not built here** (Docker daemon unavailable on the dev machine) |
| Unimplemented features documented | ✅ | below |

## Performance

Targets: dashboard server render ≤ 300 ms and other pages ≤ 200 ms at p95 for a typical
household (≈ 2,000 transactions/year); no client request waterfalls; transaction lists paginated.

Measured (production build, embedded PGlite, demo user with 343 transactions over 6 months,
warm, local machine, server time incl. HTML transfer): Overview 89–101 ms, Reports 75–90 ms,
Transactions 37–39 ms, Budget 32–39 ms, Recurring 24–28 ms, Debt 18–26 ms, Goals 16–19 ms,
Accounts 13–16 ms, Settings 12–13 ms.

Not yet measured: large histories (10k+ transactions), real PostgreSQL over a network, cold
starts. Reports aggregate ledger lines in application code for the selected range; if large
histories prove slow, move monthly/category aggregation into SQL `GROUP BY` (indexes already
exist on (user, date) and (user, category)).

## Known gaps and honest limitations

* **Live bank sync**: not available. The provider interface, encrypted credential storage,
  idempotent sync engine (pending→posted updates, removals, consent expiry, retry back-off) and
  UI state are built, but no NZ open-banking provider is integrated — that requires a commercial
  agreement (e.g. with an aggregator such as Akahu) and app registration. CSV import is the
  supported path. The sync engine is not covered by tests against a real provider.
* **Receipts/attachments**: table exists; upload, storage and viewing are not built.
* **Household sharing**: data is scoped per user; shared households are not implemented.
* **Budget periods**: monthly only. Fortnightly pay is supported for income, forecasts and
  goals, but budgets are per calendar month.
* **Multi-currency**: per-account currencies are stored and never mixed, but there is no
  conversion; other-currency accounts are excluded from totals. Transfers between accounts in
  different currencies are rejected.
* **Notifications**: evaluated when the user opens Overview (throttled to every 10 minutes per
  process), not by a background scheduler, so email alerts only go out after a visit. Push
  notifications are designed for (channel interface) but not implemented.
* **PDF export**: not built; reports have a print-friendly layout (`window.print()`).
* **Rate limiting** for app endpoints is in-memory (per process).
* **Docker image** not built or run in this environment.
* **Accessibility**: semantic structure, labels, focus styles, keyboard paths, reduced motion
  and chart table alternatives are in place and exercised via role/label-based e2e selectors,
  but no formal WCAG 2.2 AA audit or screen-reader test pass has been done. The validated chart
  palette has three light-mode colours below 3:1 against the surface; every chart therefore has
  a visible legend and a table view.
* **Pruning/retention jobs** for notifications and audit events are not implemented.
* **Assistant with a live model**: the AI path is implemented against the Anthropic SDK but was
  only exercised in “direct answers” mode here (no API key available); tool execution itself is tested.

## Next steps (suggested order)

1. Integrate an NZ open-banking provider behind `BankingProvider` and run the sync engine against its sandbox.
2. Background scheduler for notifications + email digests.
3. Receipt uploads (object storage, type/size validation, malware scanning).
4. Household sharing (shared accounts/budgets with roles).
5. Formal accessibility audit and a performance run with 10k+ transactions on PostgreSQL.
