# Budget Coach

A chat-first personal budget coach: tracks money in and out, per-category spending limits, and progress toward a savings goal.

## Language

**User**:
The person authenticated via Clerk who owns one isolated set of Transactions, Category limits, and a Savings Goal. No sharing between Users — each has their own budget.
_Avoid_: account, visitor, resourceId (the internal key data is scoped by — an implementation detail, not domain language)

**Transaction**:
A single recorded movement of money — either Income or an Expense. Has a date, merchant, amount, a `type`, and (for expenses only) a Category.
_Avoid_: entry, record

**Type**:
The field on a Transaction distinguishing Income from Expense. `amount` is always stored positive; direction comes from `type`, never from sign.
_Avoid_: direction, kind

**Income**:
A Transaction whose `type` is income — any money coming in during the Period (salary, bonuses, proceeds from selling something, etc.), not limited to regular salary. Carries no Category.
_Avoid_: earnings, revenue, deposit

**Expense**:
A Transaction whose `type` is expense — money going out, tagged with a Category and checked against that Category's limit.
_Avoid_: spend, outflow, purchase

**Category**:
The fixed taxonomy used to classify Expenses only (Groceries, Dining, Transport, etc.). Income Transactions do not have a Category.
_Avoid_: type (see `Type`, which is a different field)

**Period**:
The calendar month used to scope all analysis — Income totals, Expense totals, category limits, and the Savings Goal. Replaces the app's former trailing-30-day window.
_Avoid_: month (ambiguous with calendar-date fields), window, trailing period

**Net Savings**:
Income minus Expenses for the current Period. The figure actually compared against the Savings Goal. Resets each Period — not cumulative across Periods.
_Avoid_: net, cash flow, surplus

**Savings Goal**:
The user's recurring target for Net Savings within a single Period. Checked and reset every Period — not a cumulative, deadline-based goal (e.g. "$2,000 by December" is out of scope; that would be a different concept if ever built).
_Avoid_: goal, target

## Boundary notes

- **Refunds** reduce the original Expense's Category total; they are never Income. (No refund/reversal feature exists yet — this is a definitional boundary for when one is built, not a mechanism designed now.)
- **Internal transfers** (moving money between the user's own accounts) are out of scope — the domain model has no multi-account concept, so this scenario cannot currently arise.
