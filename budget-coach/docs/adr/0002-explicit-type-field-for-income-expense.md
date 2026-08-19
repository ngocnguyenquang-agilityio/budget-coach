# Explicit `type` field distinguishes Income from Expense

Direction (income vs. expense) was previously inferred by checking `category === "Income"`, a magic-string exclusion baked into `computeAnalysis`. This let `Income` sit in the same `Category` enum as expense categories with no structural distinction — nothing stopped a `categoryLimit` from nonsensically being set on `Income`, and adding an income aggregate would have meant deepening reliance on that string check. We added an explicit `type: "income" | "expense"` field to `Transaction` and removed `Income` from the `Category` enum entirely, so `Category` now means "expense classification" and nothing else. `amount` stays always-positive; direction comes only from `type`, never from sign, to avoid every existing sum in the codebase silently breaking if a signed convention were introduced instead.

## Consequences

Schema migration: `Transaction` gains `type`; `Category` drops `Income`. Touches the categorizer agent (now infers `type` in addition to `Category`), the analyst/`computeAnalysis`, seed data, and the add-transaction UI. Existing dev DB rows tagged `category: "Income"` are not migrated — `budget-coach.db` is deleted and reseeded fresh instead (dev/seed data only).
