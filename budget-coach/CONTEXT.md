# Budget Coach

A chat-first personal budget coach: tracks money in and out, per-category spending limits, and cumulative progress toward the things a User is saving for.

## Language

**User**:
The person authenticated via Clerk who owns one isolated set of Transactions, Category Limits, Savings Pots, and a Savings Balance. No sharing between Users — each has their own budget.
_Avoid_: account, visitor, resourceId (the internal key data is scoped by — an implementation detail, not domain language)

**Transaction**:
A single recorded movement of money — either Income or an Expense. Has a date, merchant, amount, a Type, and a Status. Expenses additionally carry a Category and, when paid for out of savings, the Savings Pot that funded them.
_Avoid_: entry, record

**Type**:
The field on a Transaction distinguishing Income from Expense. The amount is always stored positive; direction comes from Type, never from sign.
_Avoid_: direction, kind

**Status**:
The field on a Transaction distinguishing money that is *forecast* from money that has *moved*. A Transaction is either **expected** (a forecast the User has not yet confirmed) or **received** (money that actually changed hands). Confirming an expected Transaction flips it to received, and lets the User correct the amount at the same time.

Only received Transactions count toward Received Income, Net Savings, the Savings Balance, and a Category's over-limit flag. Expected Transactions count only toward Forecast Income and a Category's committed figure. This distinction is what lets the app be forward-looking without ever claiming money arrived that did not.
_Avoid_: pending, projected, provisional

**Recurring Schedule**:
A repeating money movement the User maintains — a salary, rent, a utility bill. Generates one **expected** Transaction per Period. A Schedule is not itself a Transaction and holds no money; it is a rule that produces forecasts.
_Avoid_: subscription, standing order, template

**Income**:
A Transaction whose Type is income — any money coming in during the Period (salary, bonuses, proceeds from selling something), not limited to regular salary. Carries no Category.
_Avoid_: earnings, revenue, deposit

**Expense**:
A Transaction whose Type is expense — money going out, tagged with a Category. An Expense that draws on a Savings Pot names that Pot; such an Expense is excluded from Net Savings, because the money it spends was saved in an earlier Period and already sits in the Savings Balance.
_Avoid_: spend, outflow, purchase

**Category**:
The fixed taxonomy used to classify Expenses only (Groceries, Dining, Transport, etc.). Income Transactions do not have a Category.
_Avoid_: type (see `Type`, which is a different field)

**Period**:
The calendar month used to scope all analysis — Income totals, Expense totals, Category Limits, and every Savings Pot's monthly rate.
_Avoid_: month (ambiguous with calendar-date fields), window, trailing period

**Period Close**:
The moment a finished Period's figures are settled: its Net Savings rolls into the Savings Balance, that roll-up is allocated across Savings Pots, and any Transaction still expected is expired. Period Close happens inside a Monthly Review, and a Review closes *every* Period left unclosed since the last one — so skipping a month defers the close rather than losing it.
_Avoid_: month end, rollover, settlement

**Forecast Income**:
The sum of the current Period's Income Transactions, expected and received together — what the User can plan against. The income basis for the Cap. Derived, never stored.
_Avoid_: declared income, expected income (this figure includes received Income too)

**Received Income**:
The sum of the current Period's **received** Income Transactions — what has actually arrived. Shown beside Forecast Income so the gap between the two is visible without inference. Derived, never stored.
_Avoid_: actual income, real income

**Category Limit**:
The per-Category ceiling on **received** Expense spending within a Period. Set by an approved Monthly Review or Refit; the sum of all Category Limits must never exceed the Cap. Persists across Periods until a later Review or Refit changes it — unlike Net Savings, it does not reset each Period.

A Category also carries a *committed* figure — received plus still-expected spending — which does not trip the over-limit flag but does drive an "on track to exceed" warning. Overspending is a different message from being about to overspend.
_Avoid_: budget, cap (see `Cap`, which is the ceiling on the limits themselves)

**Commitment**:
A claim on Forecast Income that is not available to be spent through Category Limits. **Every Savings Pot's current monthly rate is a Commitment, and there are no other kinds** — this is the whole ledger. A single ledger is what keeps two processes from each quietly assuming the same money.
_Avoid_: reservation, earmark, allocation (see `Unallocated`, where allocation means something else)

**Cap**:
`Forecast Income − sum(Commitments)`. The single ceiling on the sum of all Category Limits, read by both the Monthly Review and the Refit — **neither process derives a cap of its own.** A change that would drive the Cap to zero or below is refused rather than accepted with degenerate limits.
_Avoid_: headroom, capacity, free cash

**Net Savings**:
For a Period: **received** Income minus **received** Expenses that were not funded by a Savings Pot. The figure that rolls into the Savings Balance at Period Close. Resets each Period — the Balance is what accumulates, not this.
_Avoid_: net, cash flow, surplus

**Savings Balance**:
The User's cumulative saved money. Grows (or shrinks) at Period Close by that Period's Net Savings, signed — a Period of overspending draws it down. Falls when a Savings-Pot-funded Expense draws on a Pot. Every dollar of the Balance is either held by a Savings Pot or sits Unallocated.
_Avoid_: savings, total saved, savings account (the app tracks a figure, not a real account)

**Unallocated**:
The part of the Savings Balance not held by any Savings Pot — money saved but not yet spoken for. A Period Close roll-up lands here first and is then allocated out to Pots; deleting a Pot returns its balance here.
_Avoid_: unassigned, general fund, spare

**Savings Pot**:
A named holding of part of the Savings Balance, and **the only way a User expresses "I am putting money toward something."** A Pot is one of two shapes:

- **target-driven** — a target amount with an optional deadline (e.g. "Laptop, $1,200, by March"). Its monthly rate is *re-derived each Period* as remaining ÷ months left, so falling behind raises the rate rather than hiding the shortfall. **Without a deadline there are no months to divide by, so an open-ended target Pot's rate is zero: it claims nothing until the User gives it a deadline, and fills from whatever sits Unallocated.**
- **rate-driven** — an explicit amount per month with no target and no end (e.g. "$500 a month").

Every Pot's current rate is a Commitment. A Pot's balance is real money within the Savings Balance, not a self-reported figure: it grows only through allocation from Unallocated, and falls only when an Expense names it. A Pot that reaches its target persists, marked complete, with its Commitment dropped to zero — reaching a target and spending the money are separate events, and the Pot must survive between them to fund the purchase.
_Avoid_: fund, bucket, envelope, goal (see `Savings Goal`, which is derived from Pots)

**General Savings**:
The default rate-driven Savings Pot, created automatically the first time a User states a savings rate without naming a destination ("save $500 a month"). Exists so that a User who wants to save without a reason never has to learn the word "Pot".

**Savings Goal**:
The sum of every Savings Pot's current monthly rate — what the User is committed to setting aside this Period. **Derived and displayed only: never stored, never set directly.** "Set my savings goal to $500" is a shorthand that creates or updates the General Savings Pot; the phrase survives in the User's mouth without existing in the model.
_Avoid_: target, monthly target

**Monthly Review**:
The once-per-Period, backward-looking process. It performs Period Close for every unclosed Period (rolling Net Savings into the Savings Balance and allocating it across Pots, both confirmed by the User, and expiring Transactions still expected), then re-derives per-Category proportions from trailing received spend and proposes Category Limits that fit within the Cap.
_Avoid_: review, budget review

**Refit**:
The forward-looking process, run **whenever the Commitment ledger changes** — a Pot created, a rate or deadline changed, income revised, or a Period boundary crossed (target Pots re-derive their rates, so the Cap moves on its own). It recomputes the Cap and, when the current Category Limits no longer fit beneath it, proposes proportionally scaled limits for approval. Because it runs on change rather than on request, Category Limits move only when something that actually claims money moved.
_Avoid_: funding plan, savings planner, affordability check, rebalance (the process no longer funds a stated target — it re-fits limits to the Cap)

**Proposed Limits**:
The Category Limit values a Monthly Review or Refit computes but that have not yet been approved. Becomes the new Category Limits only if the User approves; discarded if rejected.
_Avoid_: draft limits, suggested limits

**Pending Approval**:
The state of a Monthly Review or Refit that has proposed its Proposed Limits and is waiting on the User's approve/reject decision. At most one may be Pending Approval for a User at a time, across both processes.
_Avoid_: in progress, suspended (an implementation detail of how this state is persisted, not the domain state itself)

**Coach Preferences**:
The User's explicitly stated, resource-scoped adjustments to how the Coach communicates — verbosity, form of address, and which Categories to emphasize. Persists across threads like Category Limits and Savings Pots. Never overrides a guardrail or suppresses required information (e.g. over-limit flags) — Preferences affect only how the Coach talks, never what it is required to report or refuse.
_Avoid_: settings, config (implementation-flavored, not domain language)

## Boundary notes

- **A Transaction that is expected and never confirmed expires at Period Close.** It is not rolled forward and never auto-confirms: last month's missing paycheck is not this month's income, and a bill that went unpaid is an unpaid debt, which this domain does not model.
- **Refunds** reduce the original Expense's Category total; they are never Income. (No refund feature exists yet — this is a definitional boundary for when one is built.)
- **Internal transfers** between the User's own real-world accounts are out of scope; the domain has no multi-account concept. Moving money *into savings* is modelled as allocation from Unallocated to a Savings Pot, which is not a Transaction and never touches the ledger.
- **A Savings Pot holds a figure, not money.** It partitions the Savings Balance, which is itself derived from recorded Transactions — the app never asserts what is in the User's bank.
- **A Pot-funded Expense still counts against its Category Limit.** It is excluded from Net Savings (the money was saved earlier), but it is still spending, and exempting large purchases from limits is how a budget stops telling the truth.
- **The Cap can only be enforced once income is on record.** With no Income Transactions in the Period there is nothing to take a share of, so a Commitment is accepted unchecked rather than refused — a User naming a savings amount before logging a paycheck is not over-committed, just new.
