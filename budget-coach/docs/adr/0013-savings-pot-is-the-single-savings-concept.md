# Savings Pot is the single savings concept; Savings Goal and Target are derived

Supersedes [ADR-0003](./0003-savings-goal-recurring-monthly-target.md) and [ADR-0010](./0010-savings-pots-pure-projection-trackers.md).

There is now exactly **one** way for a user to say "I am putting money toward something": create a **Savings Pot**. A Pot holds part of the real Savings Balance ([ADR-0012](./0012-savings-balance-accumulates-net-savings.md)) and is one of two shapes — **target-driven** (amount + optional deadline, rate re-derived each Period as `remaining ÷ months left`) or **rate-driven** (an explicit per-month amount, open-ended). `Savings Goal` and `Target` cease to be stored concepts.

## Why

The app had **three doors into one intent** — `setSavingsGoal`, `planFunding({kind: "savings"})`, and `createSavingsPot` — with three different sets of teeth and no rule for choosing between them. A savings Target silently overwrote an existing Savings Goal. A Pot had no teeth at all by design, so `computePotProgress` would report a $5,000/mo pot on a $3,000 income as `onTrack` while `computeFundingPlan`, running the same arithmetic, called it `infeasible`. Same math, two contradictory answers, reachable in the same conversation.

Separately, ADR-0010's `contributeToPot` was a money movement with no ledger trace: it touched neither Expenses nor Net Savings, so a Pot balance and the budget could never be reconciled. With a real Savings Balance to allocate from, that tool is unnecessary and is deleted.

## Considered Options

- **Pot as named allocation, `Savings Goal` surviving alongside** as the general unnamed target — rejected: it keeps two ways to express the same intent, which is the original complaint.
- **Pot stays a pure tracker** with read-only validation against the Balance — rejected: this is ADR-0010 with a warning label; the drift stays.
- **Every Pot target-driven**, with General Savings given a synthetic far-future target — rejected: a fake date in the data that every reader must know to ignore.
- **Every Pot rate-driven**, converting a target+deadline to a fixed rate at creation — rejected, and this is the sharper call. It gives the Commitment ledger one uniform shape, but it *freezes* the rate. A target-driven Pot must re-derive its rate each Period so that falling behind **raises** the required monthly figure and grows its claim on headroom. Freezing it lets a user drift and never be told.
- **Auto-delete a Pot on completion** — rejected: it deletes the Pot at the exact moment its balance matters most, since reaching a target and spending the money are separate events.
- **Automatic allocation from Unallocated by rate, silently** — rejected: it moves the user's money without telling them. **Allocation on request only** was also rejected: it leaves Pots at zero for anyone who does not do bookkeeping, quietly recreating the self-reported drift this ADR exists to kill.

## Consequences

- `SavingsPot` becomes a union of two shapes rather than one, and `savedSoFar` stops being self-reported: a Pot's balance grows *only* through allocation from Unallocated and falls *only* when an Expense names it.
- **A purchase is a Pot.** "Can I afford a $1,200 laptop by March" creates a target-driven Pot, registers its Commitment, and re-fits limits; buying it draws the Pot down. This gives the user a standing record of *why* their limits are tight, which a transient `Target` never left behind. `Target` is deleted as a stored concept.
- **`Savings Goal` survives as vocabulary, not as state.** Going in, "set my savings goal to $500" is a shorthand that creates or updates the **General Savings** Pot — a default rate-driven Pot, so a user who wants to save without a reason never learns the word "Pot". Coming out, the displayed Savings Goal is the *derived* sum of every Pot's current rate. The user's phrasing is untouched in both directions while the model holds one concept.
- Period Close proposes an allocation of the roll-up across Pots — pro-rata by rate when Unallocated falls short — and the user confirms or edits it, riding [ADR-0012](./0012-savings-balance-accumulates-net-savings.md)'s existing confirmation rather than adding a second one.
- A completed Pot persists, marked complete, with its Commitment dropped to zero. Deleting any Pot returns its balance to Unallocated.
- Deleted: `contributeToPotTool`, `setSavingsGoalTool`'s direct write, `savingsGoal` as a stored field, and `TargetSchema` as persisted state.
