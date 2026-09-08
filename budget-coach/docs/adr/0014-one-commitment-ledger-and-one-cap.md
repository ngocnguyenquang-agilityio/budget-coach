# One Commitment ledger, one Cap, and a Refit triggered by change

Supersedes the cap formula in [ADR-0007](./0007-category-limits-capped-by-declared-income-and-savings-goal.md) and the Capacity model in [ADR-0009](./0009-goal-funding-plan-workflow.md).

There is one **Commitment** ledger — every Savings Pot's current monthly rate, and nothing else — and one **Cap**: `Forecast Income − sum(Commitments)`. Both the Monthly Review and the **Refit** read it; **neither derives a cap of its own.** The Refit — what the old Funding Plan becomes, renamed because there is no longer a Target to fund — stops being user-invoked and instead runs **whenever the Commitment ledger changes**.

## Why

Two processes each computed a cap-shaped quantity by a different formula, and could silently unfund each other:

- Monthly Review used `Declared Income − Savings Goal`. Funding Plan used `Declared Income − required/month` and **never subtracted the Savings Goal at all** for a purchase Target. Concretely: income $3,000, goal $500, limits summing $2,500. "Can I afford a $1,200 laptop?" scaled the cap to $1,800, leaving $1,200 of headroom — every cent of which the laptop needed. The $500 savings goal was silently unfunded, and nothing said so.
- On the savings path the failure inverted: the Funding Plan set `savingsGoal = requiredPerMonth`, *replacing* an existing goal rather than reconciling with it.

Separately, the Monthly Review was gated to once per Period by `lastReviewPeriod` while the Funding Plan had no gate at all — so limits could be re-cut arbitrarily, routing around the review discipline entirely.

`Capacity` (`Declared Income − sum(Category Limits)`) disappears as a decision input: once limits are capped by a single authority, the slack beneath them is an output, not something a process measures against.

## Considered Options

- **Keep two caps, but make the Funding Plan subtract the Savings Goal**, plus a "this replaces your current goal, confirm?" prompt — the one-line fix. Rejected: it corrects today's bug and will be re-derived the moment a second concept wants to claim headroom, which Savings Pots already do.
- **Merge Monthly Review and the Refit into one `Rebalance` process** — rejected: a Monthly Review re-derives per-Category *proportions* from trailing received spend, while a Refit *preserves* existing proportions and only scales. Merging turns a real difference into an `if` branch, and the Review also owns Period Close, which has nothing to do with funding.
- **Demote Monthly Review to a read-only report** — rejected for the same reason: proportion re-derivation from actual habits is genuinely its job.
- **Keep it user-invoked**, warning when limits no longer fit — rejected: it leaves the cadence problem needing a separate invented gate. Triggering on change dissolves it instead, because limits then move only when something that actually claims money moved.
- **Also offer a manual "re-fit my budget" entry point** alongside the trigger — rejected as redundant: with no Commitment change and no new spend data, a re-fit returns the limits you already have.
- **Accept a Commitment that drives the Cap to zero or below**, proposing near-zero limits so the user sees the consequence — rejected; `proposeCategoryLimits` already refuses a non-positive cap for good reason.

## Consequences

- The refusal threshold is **`Cap ≤ 0`, not "the cuts are large"**. A Pot that merely requires painful cuts goes through the normal approval card so the user can see them and decline; only a genuinely impossible one ("save $5,000/mo on $3,000") is refused outright, with the Coach offering to extend the deadline or lower the target.
- A Pot that cannot be funded is not created. Allowing an "unfunded" Pot that claims no headroom was considered and left out of v1: it is a legitimate user desire ("track it, I know I can't afford it yet") but reintroduces two kinds of Pot, which [ADR-0013](./0013-savings-pot-is-the-single-savings-concept.md) exists to collapse.
- `scaleLimitsToCap` remains the one scaling primitive shared by both processes; what changes is that both now receive the *same* cap rather than each computing one.
- Because a target-driven Pot re-derives its rate every Period, the Commitment ledger — and therefore the Cap — **moves on its own as deadlines approach**. A Period boundary is itself a Commitment change, so the Refit's trigger must fire there too, not only on explicit user edits.
- `lastReviewPeriod` still gates the Monthly Review to once per Period, but no longer needs a mirrored gate on the Refit.
- Removed: `Capacity` and `computeFundingPlan`'s independent cap derivation; the `fits` / `infeasible` outcome split collapses into "does the new Cap still fit the current limits, and is it positive".
