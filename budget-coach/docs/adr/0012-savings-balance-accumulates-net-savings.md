# Net Savings accumulates into a Savings Balance, closed per Period

The app now has a **Savings Balance**: the user's cumulative saved money, grown (or shrunk) at **Period Close** by that Period's Net Savings, *signed*. Every dollar of the Balance is either held by a Savings Pot or sits **Unallocated**.

## Why

Before this, `Net Savings` reset every Period and accrued nowhere. The Savings Goal was a target with no consequence for hitting it and none for missing it; six months at $500/mo left nothing in the model showing $3,000. The only cumulative money figure in the entire app was a Savings Pot's self-reported `savedSoFar`, which nothing reconciled against anything.

That absence is the root of why the app's concepts felt unrelated: Net Savings had no destination, so nothing downstream depended on it. Giving it one is what lets Savings Pots stop being fiction (see [ADR-0013](./0013-savings-pot-is-the-single-savings-concept.md)).

## Considered Options

- **Stay per-Period and forward-looking only** — accept that this is a budgeting app, not an accounting one, and the real balance lives in the user's bank. Rejected: it leaves a savings goal that means nothing when you hit it.
- **A self-reported balance** (the user tells us the number) — rejected: it is `savedSoFar` again at a larger scale, with the same unreconcilable drift.
- **Automatic, floored at zero** (`Balance += max(0, netSavings)`) — rejected: the balance never decreasing feels better and is false the moment someone overspends.
- **Automatic and silent, signed** — rejected in favour of confirmation. The roll-up is the number that becomes "the user's savings"; it warrants a moment of consent, and that moment gives the Monthly Review a job beyond adjusting limits.
- **Fully partitioned Balance** (`Balance = sum(pot balances)`, no Unallocated) — rejected: it forces an allocation decision on every roll-up including the very common "just save it" case, and makes deleting a Pot a data-loss question rather than a trivial one.

## Consequences

- **Net Savings gains two exclusions**, and its definition is now materially narrower than it was: received Income minus received Expenses *not funded by a Savings Pot*. The Pot-funding exclusion exists so that buying a thing you saved for does not debit the Balance twice — once through the Pot and once through the roll-up — and does not show the purchase month as a crater. Worked example: save $300/mo for four months → $1,200 in a Laptop Pot. In month five you buy it: Net Savings is a normal $300, the Pot is debited $1,200, the Balance moves −$900. Correct — $300 arrived, $1,200 left.
- `Transaction` gains a nullable reference to the Savings Pot that funded it.
- **Period Close is a distinct domain event**, and a Monthly Review closes *every* unclosed Period since the last one. Skipping a month defers the close rather than losing that month's savings — but it means a Review can present several months of roll-ups at once, and the UI must handle that rather than assume one.
- The roll-up lands in Unallocated, then is allocated to Pots by a user-confirmed proposal in the same Period Close step (see [ADR-0013](./0013-savings-pot-is-the-single-savings-concept.md)).
- The Balance is derived from recorded Transactions, so it will diverge from the user's real bank balance whenever they fail to record something. The app must present it as "what your recorded budget implies", never as an account balance.
