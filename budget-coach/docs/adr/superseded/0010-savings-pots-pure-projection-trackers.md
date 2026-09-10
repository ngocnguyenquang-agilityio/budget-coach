# Savings Pots are pure projection trackers, decoupled from the budget

> **Superseded by [ADR-0013](../0013-savings-pot-is-the-single-savings-concept.md).** Pots are no longer pure projections: they hold part of a real Savings Balance and their rates are the Commitment ledger.

We added **Savings Pot** — a named, cumulative tracker toward a fixed target across Periods — as a third money concept beside the recurring `Savings Goal` and the `Funding Plan` workflow. A Pot is a *projection*: it holds no real money, its `savedSoFar` is a self-reported running balance (not derived from Transactions), and it never constrains Category Limits or the ADR-0007 cap. This preserves a clean division of labor — Savings Goal owns the per-Period net target that reshapes the cap, Funding Plan turns a target into re-fitted limits, and a Pot only tracks progress — and keeps Pots out of the multi-fund cap-splitting complexity that giving them "teeth" would require.

## Considered Options

- **Give Pots budgeting teeth** (a Pot's required/month reduces the ADR-0007 cap like the Savings Goal does) — rejected: summing many concurrent Pots' required/month into one cap is thorny and duplicates what `Funding Plan` already does. A user who wants a Pot to actually reshape their budget runs `planFunding` on it.
- **Earmarked-transaction balance** (a new "savings contribution" Transaction flavor tagged to a Pot; balance = sum) — rejected for v1: breaks the Income/Expense-only Transaction taxonomy. A possible v2 that would also give Pots a real audit trail.
- **Net-Savings-derived balance** (auto-allocate a slice of each Period's Net Savings) — rejected: with many concurrent Pots, splitting one Net Savings figure across them is ambiguous.
- **A LibSQL `savings_pots` table** — rejected for v1: Pots are few, small, and resource-scoped like `savingsGoal`, so they live in working memory and ride the existing `agent.state` sync. A table only earns its keep once Pots carry per-contribution history.

## Consequences

- A user's Pot balances can drift from their actual Net Savings with nothing reconciling them — accepted for v1 (`savedSoFar` is self-reported).
- Deriving balances from earmarked Transactions, and a `savings_pots` table to back them, are the natural v2 upgrades if audit history is wanted.
- Pots are stored in the Coach's resource-scoped working memory (`savingsPots` on `BudgetState`), keyed by name (case-insensitive; duplicate names rejected).
