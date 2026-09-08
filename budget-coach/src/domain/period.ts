// Period = the calendar month (YYYY-MM) every figure in the app is scoped to.
// Kept in its own module because both Savings Pots and the refit math need
// month arithmetic, and neither should depend on the other.

export const currentPeriod = (): string => new Date().toISOString().slice(0, 7);

export const periodOf = (date: string): string => date.slice(0, 7);

// Whole-month distance between two YYYY-MM strings (toPeriod − fromPeriod).
// Negative when toPeriod precedes fromPeriod; callers clamp as needed.
export const monthDiff = (fromPeriod: string, toPeriod: string): number => {
  const [fromYear, fromMonth] = fromPeriod.split("-").map(Number);
  const [toYear, toMonth] = toPeriod.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

export const addMonths = (period: string, months: number): string => {
  const [year, month] = period.split("-").map(Number);
  const zeroBased = (year * 12 + (month - 1)) + months;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
};

// Every Period strictly after `lastClosed` and strictly before `current` —
// the Periods a Monthly Review must close before it can propose anything
// (ADR-0012). The current Period is excluded: it isn't finished yet.
//
// `lastClosed` undefined means nothing has ever been closed; we return only
// the immediately preceding Period rather than every month since the epoch,
// so a brand-new user's first Review doesn't try to close a decade.
export const unclosedPeriods = (lastClosed: string | undefined, current: string): string[] => {
  if (!lastClosed) {
    const previous = addMonths(current, -1);
    return [previous];
  }

  const gap = monthDiff(lastClosed, current);
  if (gap <= 1) return [];

  return Array.from({ length: gap - 1 }, (_, index) => addMonths(lastClosed, index + 1));
};
