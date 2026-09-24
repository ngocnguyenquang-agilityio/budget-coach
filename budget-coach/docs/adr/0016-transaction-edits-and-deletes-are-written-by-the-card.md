# Transaction edits and deletes are confirmed and written by the card, never by the model

## Context

Users need to correct misrecorded Transactions ("that Grab was $12, not $21", "delete the duplicate coffee") by asking the Coach, and every such change must wait for an explicit confirm/cancel from the User. The model must not be able to skip the confirmation, nor apply values different from the ones the User saw.

## Decision

Edits and deletes go through a `useHumanInTheLoop` card that performs the write itself via an API route, then reports the outcome to the model — the same shape as the `confirmTransactions` add flow (Gate 1). **No edit or delete tool is exposed to the Coach.** The Coach's job ends at resolving the request to a concrete set of Transaction ids (via `listTransactions`) and proposing the change.

- One card carries **one kind of action** — all deletes, or all edits. An edit is a per-row patch (`{ id, changes }[]`) over merchant, note, amount, date, and Category only. At most 25 rows per card.
- Every row starts ticked; the User may untick rows. Unticked rows and Cancel write nothing.
- The card sends back the **"before" snapshot** it displayed. The route re-validates each ticked row server-side (exists, still matches the snapshot, eligible, new values valid) and applies the rows that pass. **Failures are per row, not per batch**: a stale, missing, or ineligible row fails alone and is reported; the rest are applied. The card turns into an outcome summary and the Coach restates any failures, offering — never auto-running — a re-look.
- Ineligible rows (pot transfers, Pot-funded Expenses, unconfirmed Schedule-generated rows; plus delete or cross-Period date moves of confirmed Schedule-generated rows, which `materializeSchedules` would regenerate) are left off the card by the Coach with a stated reason, and refused again by the route regardless.
- Future dates are refused (a received Transaction cannot be in the future). Any past date is accepted; closed Periods are handled by ADR-0015.
- `refitNeeded` is computed from the applied rows only and passed back to the model, which calls `refitBudget` only on that flag.
- There is no undo: the confirmation is the gate.
- A correction needs no chat thread. Working memory is resource-scoped, so the route reads and writes it (ADR-0015 baselines included) by the User alone — the same write path can serve a dashboard control with no chat open.

## Considered Options

- **Card returns only confirm/cancel; the Coach then calls a server `editTransaction`/`deleteTransaction` tool.** Rejected: the tool exists independently of the card, so the model can call it without ever showing the card, or with values that differ from what was confirmed.
- **Server tool suspends (`suspend()` + `useInterrupt`).** Rejected: that channel is Pending Approval, of which at most one may exist per User across the Monthly Review and Refit — a correction would block, or be blocked by, a budget approval.
- **All-or-nothing batches.** Rejected in favour of per-row outcomes: one stale row shouldn't discard the other corrections the User just confirmed.
