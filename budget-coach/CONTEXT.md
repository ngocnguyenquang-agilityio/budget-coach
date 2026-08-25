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

**Category Limit**:
The per-Category ceiling on Expense spending within a Period, set by an approved Monthly Review. The sum of all Category Limits a Monthly Review proposes must not exceed Declared Income minus Savings Goal. Persists across Periods until a later Monthly Review changes it — unlike Net Savings, it does not reset each Period.
_Avoid_: budget, cap (see `Monthly Review`, `Proposed Limits`, `Declared Income`)

**Period**:
The calendar month used to scope all analysis — Income totals, Expense totals, category limits, and the Savings Goal. Replaces the app's former trailing-30-day window.
_Avoid_: month (ambiguous with calendar-date fields), window, trailing period

**Net Savings**:
Income minus Expenses for the current Period. The figure actually compared against the Savings Goal. Resets each Period — not cumulative across Periods.
_Avoid_: net, cash flow, surplus

**Declared Income**:
The User's explicitly stated income figure — provided when a Monthly Review runs, or reported later if it changes — persisted across Periods until replaced. Distinct from `Income` (the Transaction type, an actual recorded movement of money): Declared Income is never inferred from summed Income Transactions, and is the basis a Monthly Review uses to cap its Proposed Limits.
_Avoid_: income, expected income (see `Income`, a different concept)

**Savings Goal**:
The user's recurring target for Net Savings within a single Period. Checked and reset every Period — not a cumulative, deadline-based goal (e.g. "$2,000 by December" is out of scope; that would be a different concept if ever built).
_Avoid_: goal, target

**Monthly Review**:
The recurring, once-per-Period process that compares spending against the current Category Limits and produces Proposed Limits for the user to accept or reject. Approving replaces the Category Limits with the Proposed Limits; rejecting leaves them unchanged.
_Avoid_: review, budget review

**Proposed Limits**:
The Category Limit values a Monthly Review computes but that have not yet been approved. Becomes the new Category Limits only if the user approves; discarded if rejected.
_Avoid_: draft limits, suggested limits (see `Category Limit`, which is a different, approved thing)

**Pending Approval**:
The state of a Monthly Review that has proposed its Proposed Limits and is waiting on the user's approve/reject decision. At most one Monthly Review may be Pending Approval for a User at a time.
_Avoid_: in progress, suspended (an implementation detail of how this state is persisted, not the domain state itself)

**Coach Preferences**:
The User's explicitly stated, resource-scoped adjustments to how the Coach communicates — verbosity, form of address, and which Categories to emphasize. Persists across threads like Savings Goal and Category Limit. Never overrides a guardrail or suppresses required information (e.g. over-limit flags) — Preferences affect only how the Coach talks, never what it's required to report or refuse.
_Avoid_: settings, config (implementation-flavored, not domain language)

## Boundary notes

- **Refunds** reduce the original Expense's Category total; they are never Income. (No refund/reversal feature exists yet — this is a definitional boundary for when one is built, not a mechanism designed now.)
- **Internal transfers** (moving money between the user's own accounts) are out of scope — the domain model has no multi-account concept, so this scenario cannot currently arise.
