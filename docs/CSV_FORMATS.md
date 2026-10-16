# CSV formats

## Import

Ledger reads CSV exports from internet banking. The importer auto-detects columns from
the header row and lets you correct the mapping before anything is saved.

**Required columns** (any header names; these are recognised automatically):

| Field | Recognised headers |
|---|---|
| Date | `Date`, `Transaction Date`, `Posted Date`, `Processed Date` |
| Description | `Description`, `Details`, `Transaction Details`, `Narrative`, `Memo`, `Particulars` (or `Payee` if there’s no description) |
| Amount | `Amount`, `Value`, `Transaction Amount` — **or** both `Debit`/`Withdrawals`/`Money out` and `Credit`/`Deposits`/`Money in` |

**Optional**: `Payee`/`Other Party`/`Merchant`, `Reference`/`Code`, `Notes`, `Category`
(matched to your category names), `Unique Id`/`Transaction ID`/`FITID` (used for duplicate
detection). ANZ-style `Particulars` and `Code` columns are appended to the description.

Rules:

* Delimiter: comma, semicolon or tab (detected). UTF-8, with or without BOM. Quoted fields
  with embedded commas, quotes (`""`) and line breaks are supported.
* Dates: `DD/MM/YYYY` (NZ default), `MM/DD/YYYY`, `YYYY-MM-DD`; `/`, `-` or `.` separators;
  two-digit years mean 20xx. Ambiguous files default to day-first; you can change it.
* Amounts: signed (`-12.50` = money out), `$`/currency prefixes, thousands separators,
  `(12.50)` and `12.50 DR`/`CR` are understood. Card exports that show purchases as positive
  can be flipped with “Purchases are positive in this file”.
* Limits: 2 MB and 10,000 rows per file. Rows with unreadable dates/amounts are listed and skipped.
* **Duplicates**: each row gets a fingerprint (account + date + amount + normalised
  description + occurrence number within the file). Re-importing a file skips rows already
  imported; two genuinely identical purchases on the same day are both kept. Rows matching a
  manually-entered transaction (same amount within 2 days) are flagged as possible duplicates
  and skipped unless you include them.
* Imports run in one database transaction and can be undone from the import page.

Example (ANZ layout):

```csv
Type,Details,Particulars,Code,Reference,Amount,Date
Eft-Pos,COUNTDOWN PONSONBY,4835****1234,,,-82.15,14/09/2026
Salary,ACME LTD,,,PAY,"2,350.00",15/09/2026
```

## Export

`Transactions → Export CSV` (respects the current filters) or `Settings → Your data`.

| Column | Meaning |
|---|---|
| Date, Time | Calendar date (YYYY-MM-DD), optional HH:MM |
| Account | Account name |
| Payee, Description | Display name and original bank text |
| Category | Category; `Transfer (Other account)`; `Balance adjustment`; `Split` |
| Amount | Signed decimal in the account currency (`-12.50`) |
| Currency | ISO code |
| Type | `standard` / `transfer` / `adjustment` |
| Status | `pending` / `cleared` / `reconciled` |
| Split part, Splits | Split detail (see below) |
| Tags, Notes, Reviewed, Id | — |

* Default: one row per transaction; split parts are listed in the `Splits` column.
* `?splits=rows` (“one row per split”): each split part is its own row with its category and
  amount, so spreadsheet sums by category are exact.
* Text cells beginning with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to prevent
  spreadsheet formula injection. Numeric columns are left as plain numbers.

Report export (`Reports → CSV`) contains a month-by-month summary followed by a category
breakdown for the selected range. Full JSON export (`/api/export/all`) contains every record
Ledger stores for you, with money in minor units; it excludes password hashes, TOTP secrets
and session tokens.
