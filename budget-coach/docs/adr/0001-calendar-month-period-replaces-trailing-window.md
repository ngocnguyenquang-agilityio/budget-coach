# Calendar-month Period replaces the trailing-30-day window

Spending and limit analysis (`computeAnalysis`) previously scoped everything to a rolling trailing-30-day window, not a calendar month, despite the UI and domain language ("monthly savings goal," `lastReviewDate`) already talking in terms of months. Adding Income and a checkable Savings Goal made this inconsistency untenable — both concepts only make sense against the calendar month a salary actually lands in. We switched the analysis engine's `Period` to calendar-month scoping, accepting the loss of the trailing window's smoother, no-reset behavior in exchange for a period definition that matches how income, expenses, and the savings goal are actually reasoned about.

## Consequences

Touches `computeAnalysis`, the Monthly Review workflow, and the dashboard's `visibleMonth` label (previously cosmetic-only, now load-bearing). Early-month views will show sparse data compared to the old rolling window.
