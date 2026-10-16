# Financial rules

These rules are implemented in `src/domain` (pure, unit-tested) and applied by the
services in `src/server/services`. Every rule below has a test in `tests/unit` or
`tests/integration`.

## Money

* All amounts are **integers in the currency’s minor unit** (cents for NZD), stored as
  `bigint` and handled as JS numbers guarded by `Number.isSafeInteger`.
* No floating-point arithmetic on money. Ratios and rates use `BigInt` intermediates
  (`mulDiv`) with **round half away from zero**. Formatting goes through an exact
  decimal string (`toDecimalString`), never `cents / 100`. (Chart axis tick labels are
  the only place a value is divided for display; tooltips show exact amounts.)
* User input is parsed by `parseAmount` (accepts `1,234.56`, `$12`, `(12.00)`, `12 DR/CR`;
  rejects extra decimal places that aren’t zeros).
* Currency is stored on every account and transaction. **Amounts in different
  currencies are never summed.** Totals use the user’s main currency; other-currency
  accounts are listed separately and flagged. Foreign-currency purchases can record the
  original amount/currency alongside the account-currency amount.
* Allocation across parts (`allocate`) uses the largest-remainder method so parts always
  sum exactly to the total.

## Sign convention

Amounts are signed **from the account’s point of view**: `+` money into the account,
`−` money out. Liabilities therefore have negative balances (a card at −$420 means $420 owed).

## Transaction kinds

| Kind | Examples | Income? | Spending? | Balance? | Budget activity? |
|---|---|---|---|---|---|
| `standard` in an income category | Salary, interest | ✔ | | ✔ | funds “ready to assign” |
| `standard` in an expense category, negative | Purchase, bill, card interest | | ✔ | ✔ | ✔ |
| `standard` in an expense category, positive | **Refund** | | reduces spending | ✔ | adds back to the category |
| `standard`, uncategorised, negative | Unknown purchase | | ✔ (reported as “uncategorised”) | ✔ | deducted from ready-to-assign |
| `standard`, uncategorised, positive | Unknown deposit | **✘ — needs review** | | ✔ | not funds until categorised |
| `transfer` (two linked legs) | Savings sweep, card payment, loan repayment | ✘ | ✘ | ✔ both accounts | only if the outflow leg has a category (e.g. loan repayments) |
| `adjustment` | Opening balance, reconciliation fix | ✘ | ✘ | ✔ | opening balances of budget accounts fund the budget |

* **Transfers** are created as two legs sharing a `transfer_group_id` (enforced by a CHECK
  constraint). Editing a transfer moves both legs; deleting removes both. Legs sum to zero,
  so net worth is unchanged.
* **Credit cards**: a purchase on the card is spending when it happens. Paying the card is a
  transfer, so it is never counted again. Card interest/fees are spending (“Interest & fees”).
* **Imported pairs**: when the same payment arrives from both the bank and the card CSV,
  Ledger lists them as “possible transfers” and the user links them with one click.
* **Splits**: a split transaction has ≥ 2 parts, each non-zero, summing **exactly** to the
  parent (validated in the domain and re-validated in the service inside the same DB
  transaction). The parent’s `category_id` must be null (CHECK constraint). Aggregation uses
  one “ledger line” per split part.
* **Pending** transactions count towards spending and balances (the money is committed) but
  are always reported separately (“includes $X pending”) and accounts show cleared vs pending.
* **Reconciled** transactions are locked: amount/date/account can’t change and they can’t be
  deleted until un-reconciled.
* Deleting or editing any transaction updates every total because **no totals are stored** —
  balances, budgets, reports and forecasts are computed from the ledger on every request.
* Every create/update/delete writes an `audit_events` row (field-level diffs; snapshots on delete).

## Balances and totals

* Account balance = sum of all its transactions (opening balance is an `adjustment`).
* **Cash** = checking + savings + cash accounts. **Spendable** = accounts marked spendable
  (default: everyday + cash). **Net worth** = assets − liabilities over accounts marked
  “include in net worth”. These three are always shown separately.
* **Safe to spend** = spendable balance − confirmed bills (and card balances) due before the
  next expected payday − safety buffer. Future income is never counted before it arrives.
  Without recurring income the horizon is month end, and the UI says so.

## Budgets

* Budgets are monthly (`budget_periods` + `budget_allocations`). Switching between envelope
  and flexible keeps every allocation and transaction.
* **Envelope**: `available = carry-in + assigned + activity`. Positive balances roll over when
  the category’s rollover flag is on; otherwise they return to ready-to-assign next month.
  Overspending is never carried silently: it’s shown as overspent and deducted from next
  month’s ready-to-assign. Ready-to-assign = budget-account balances at the start month +
  income + budget-account adjustments + transfers in from off-budget accounts − uncategorised
  outflows − uncategorised transfers out to off-budget assets − assigned − prior overspending.
* **Flexible**: assigned = monthly limit; status ok / warning (≥ alert threshold, default 85%) /
  over; warns when total limits exceed expected income.
* **Projections** extrapolate only variable (non-recurring) spending, blend the current pace
  with the 3-month average, and add scheduled bills on their due dates — so a weekly rent is
  never counted both as “pace” and as “scheduled”. Always labelled as estimates.
* **Suggestions** (consistent over/under spending) and the onboarding **starter budget** are
  never applied without the user clicking Apply/Finish. If commitments exceed income, the
  starter budget reports the shortfall instead of inventing allocations.

## Recurring payments

* Monthly/yearly rules are computed from the anchor date each time, so “the 31st” lands on
  the last day of short months and returns to the 31st; 29 Feb falls back to 28 Feb.
* An occurrence is **paid only when a matching transaction is linked** (auto-match by account,
  merchant key, amount within ±10% / ±35% for variable bills, and a date window). Its date
  passing never marks it paid: it becomes “late”, then “missed”.
* Detected subscriptions are suggestions until the user confirms them.
* “Today” is resolved in the user’s IANA time zone (default Pacific/Auckland).

## Goals

* A goal’s saved amount is the sum of its contribution records. Contributions are
  **earmarks**: they never move money and are never added to balances or net worth again.
* If goals linked to an account exceed its balance, Ledger warns that progress isn’t backed by money.
* Required contribution = remaining ÷ periods to target date, rounded **up** to the cent.

## Debt projections

Monthly interest = balance × APR ÷ 12 (rounded to the cent); one payment per month after
interest; constant total payment with freed minimums rolling to the next target; no new
borrowing; explicit rate changes only. Avalanche = highest APR first; snowball = smallest
balance first. Projections stop and warn if payments don’t cover interest. Rates the user
entered as estimates are labelled; lender-confirmed balances can be recorded alongside the
ledger balance. NZ student loans can be recorded at 0%.

## Forecast

Start balance (spendable accounts incl. pending) + confirmed recurring flows (occurrences
already matched to a transaction are skipped; transfers between included accounts are
ignored) + one-off future-dated transactions + current card balances on their due dates −
estimated variable spending (12 weeks of non-recurring outflows from spendable accounts and
credit cards; optimistic = 25th percentile week, expected = mean, conservative = 75th
percentile, at least mean × 1.15). Fewer than 4 weeks of history is flagged as insufficient.

## Metrics (as shown in Reports)

* **Income**: income-category inflows, net of corrections. Excludes transfers, adjustments,
  uncategorised deposits.
* **Spending**: expense-category outflows − refunds + uncategorised outflows. Excludes transfers.
* **Net** = income − spending. **Savings rate** = net ÷ income (n/a with no income). Money moved
  to savings/investments and loan principal repaid count as saved; interest and fees as spending.
* Comparisons use the previous period of equal length (whole months compare to whole months;
  month-to-date compares to the same days last month).
* Net-worth history starts at the first recorded transaction — earlier months aren’t invented.
