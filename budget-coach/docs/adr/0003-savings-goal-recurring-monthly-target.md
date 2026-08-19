# Savings Goal is a recurring monthly target, not a cumulative goal-by-date

The dashboard already shipped a suggestion chip — "Set a savings goal of $2,000 by December" — implying a cumulative, deadline-based goal accumulated across months. No code ever backed that framing: `savingsGoal` was a bare number nothing compared against. Now that Net Savings (Income − Expenses per Period) exists, we defined Savings Goal as a target checked and reset every calendar-month Period, consistent with how `Period` and `Net Savings` are already defined, rather than building out multi-month accumulation and deadline tracking to match the old UI copy.

## Consequences

The existing "$2,000 by December" suggestion chip is stale copy that should be fixed to a monthly framing, not a spec to satisfy. A cumulative, deadline-based goal remains a possible future concept, but is a different one from `Savings Goal` and would need its own name and design if built.
