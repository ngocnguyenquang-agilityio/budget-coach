# Backdated Transactions amend a closed Period, folded into Unallocated only

## Context

`unclosedPeriods()` (`src/domain/period.ts`) only ever returns Periods strictly after `lastClosedPeriod`. A Transaction dated into a Period that has already been closed by a Monthly Review therefore sits correctly in the ledger — `computeAnalysis` for that month reflects it if queried — but the Period is never recomputed again, so the Savings Balance permanently diverges from what the ledger actually supports. There was no mechanism to reopen a closed Period.

## Decision

When `addTransactionsTool` inserts a Transaction dated at or before `lastClosedPeriod`, it records that Period's Net Savings **at that instant, before the insert** — this is exactly the figure that was rolled into the Savings Balance when the Period closed, since nothing else ever mutates an old Period's transactions (schedule materialization and expiry only ever touch the current Period or `expected` rows, which never fed Net Savings). This baseline is stored in working memory as `pendingAmendments: { period, netSavingsAtClose }[]`.

At the next Monthly Review, `closePeriods` diffs a fresh `computeAnalysis` for each pending period against its stored baseline (`computeAmendments` in `src/domain/period-close.ts`) and folds only the **delta** into `unallocated`, before the normal close loop runs — so the correction flows into pots through that Period's own pro-rata allocation and into the post-close pots the Cap is derived from, with no separate mechanism. The amendment is shown on the approval card as an explicit "Corrections" line, and resolved (cleared from `pendingAmendments`) only when the review is approved; a rejected review leaves it pending for the next one, mirroring how a skipped close is deferred rather than lost.

The original Period's pot allocations are **never replayed**. Downstream closes have already drawn against those pots — undoing that would mean replaying every close since, for a backdating correction that is expected to be rare and usually small. `unallocated` is already defined as the part of the Savings Balance not held by any pot, and may already go negative for an overspent Period without pots being clawed back to cover it — a negative amendment behaves the same way, not as a special case.

Amendments never set `refitNeeded`: they change `unallocated` only, never a pot's rate or the Cap.

## Considered Options

- **Block backdating into a closed Period entirely.** Rejected: loses the accurate historical date, and the user's report of when the money actually moved is exactly the information being asked for.
- **Silently adjust `unallocated` on insert**, with no review step. Rejected: money moves without the user seeing it, and correcting a *closed* Period's number without ever showing them is a worse silent failure than the gap being fixed.
- **Reopen and fully re-run every close since the amended Period**, replaying pot allocations from the amended Period forward. Rejected as disproportionate: real complexity (persisting and diffing every downstream close, not just one baseline) for a correction that is expected to be occasional and modest — the pot-balance drift left behind is a documented, acceptable consequence, not the failure mode this ADR exists to prevent.
- **Store the baseline at close time** (`applyOrDiscard`) rather than at backdate time. Rejected: it leaves every Period closed *before* this change unfixable, with no safe fallback baseline to assume.

## Consequences

- A Transaction backdated into a closed Period never updates the Savings Balance immediately — the correction always waits for the next Monthly Review, same cadence as everything else Period Close touches. `approveBudgetTool`'s once-a-month guard (`lastReviewPeriod === currentPeriod()`) means a correction landing after this month's review has already run waits until next month's; this is accepted, not special-cased.
- Pot balances for an amended Period stay exactly as they were originally allocated — only `unallocated` (and, on the next close, pots drawing against the corrected `unallocated`) reflects the correction. A pot's balance can therefore run slightly "behind" what a fully-replayed close would show; this is the deliberate trade for not replaying history.
- `pendingAmendments` is an array, not a record keyed by period, because `updateWorkingMemory` merges objects — a record entry can't be reliably removed on write, which would silently re-apply an already-resolved amendment. Same reasoning as why `savingsPots` is an array.
