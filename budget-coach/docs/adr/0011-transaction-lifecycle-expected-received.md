# Transactions carry an expected/received lifecycle; Declared Income is deleted

Supersedes the Declared Income half of [ADR-0007](./0007-category-limits-capped-by-declared-income-and-savings-goal.md).

A `Transaction` now carries a **Status** of `expected` or `received`. An `expected` Transaction is a forecast the user has not yet confirmed; confirming it flips it to `received` and lets the user correct the amount. **Only `received` Transactions count toward Received Income, Net Savings, the Savings Balance, and a Category's over-limit flag.** `expected` Transactions feed Forecast Income and a Category's *committed* figure only.

On top of this, a **Recurring Schedule** (salary, rent, a utility bill) generates one `expected` Transaction per Period. `Declared Income` is deleted outright: the forward-looking income figure is now `Forecast Income` — the sum of the Period's Income Transactions, expected and received together.

## Why

ADR-0007 mirrored Declared Income into the ledger as a real Income row under a marker merchant, to get dashboard feedback. That trade cost more than it recorded:

- **Net Savings was inflated.** `computeAnalysis` never filtered the marker, so `incomeTotal` included the phantom row. A user who also logged their actual paycheck saw Net Savings — the figure compared against their savings goal — overstated by exactly their Declared Income.
- **The drift detector could only lie.** Drift was `|incomeTotal − declaredIncome| / declaredIncome`. With only the marker present that is *exactly zero, forever* — it could never detect an income *drop*, which is the case it existed for. Its sole firing path was a user logging a real paycheck, where it reported the double-count as a 20% drift. ADR-0007 recorded this as an accepted consequence; it is better described as the feature not working.

The lifecycle makes the generated row legitimate rather than merely tolerated: it no longer asserts money arrived. And **drift stops being inferred** — an expected row that goes unconfirmed, or is confirmed at a different amount, *is* the signal. The 20% heuristic, `incomeDriftOfferedPeriod`, and `DECLARED_INCOME_MERCHANT` all go away.

## Considered Options

- **Two firewalled concepts** — rename Declared Income to `Expected Income`, never write it to the ledger, and show "Expected $3,000 · Received $1,500" as its own tile. Rejected: it delivers the same dashboard feedback but keeps two income concepts where the lifecycle needs only one, and it does nothing for recurring *expenses*.
- **Derive the forward figure from the last completed Period's Income** — rejected (as in ADR-0007) because it lags a raise or job loss by a full Period; the manual override needed to fix that just re-invents a declared figure with less clarity about which number is which.
- **Income-only lifecycle** (expenses always `received`) — rejected: it builds a general mechanism and uses it once. Rent and utilities are the most predictable spending a user has, and they are exactly what a forward-looking budget wants to know about.
- **Keep the mirror, but exclude the marker merchant from `computeAnalysis`** — the cheap fix. Rejected: it corrects the arithmetic but leaves a fabricated row in the user's transaction list, which misleads the moment they scroll it.

## Consequences

- **Every read path must filter by Status** — `computeAnalysis`, `listTransactions`, the dashboard, the Analyst agent, and the Monthly Review's proportion derivation. A missed filter is *silent*: nothing throws, the numbers are simply wrong. This is the main cost of the decision and should be met with tests at each boundary, not vigilance.
- An `expected` Transaction never confirmed **expires at Period Close** — not rolled forward, never auto-confirmed. Auto-confirming would reintroduce exactly the phantom money this ADR removes. Rolling forward is wrong for income and would require modelling unpaid debt for expenses, which the domain does not do.
- `CategoryTotal` grows from one figure to two: `spent` (received) drives the over-limit flag, `committed` (received + expected) drives an "on track to exceed" warning. Every consumer — chart, progress bars, the Analyst's pinned output schema — updates with it.
- Removed: `declaredIncome` and `incomeDriftOfferedPeriod` from working memory, `DECLARED_INCOME_MERCHANT`, `setDeclaredIncomeTool`'s ledger write, the `INCOME_DRIFT_THRESHOLD` path in `addTransactionsTool`, and the integration test that pins the double-count.
- A Recurring Schedule is new persisted state. Unlike the concepts in `BudgetState`, it is list-shaped and read on every Period boundary, so it likely belongs in LibSQL beside Transactions rather than in working memory.
