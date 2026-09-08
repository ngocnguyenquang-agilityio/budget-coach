import { potRate, type SavingsPot } from "./savings-pot";

// The Commitment ledger (ADR-0014): every Savings Pot's current monthly rate,
// and nothing else. One ledger, one Cap, read by both the Monthly Review and
// the refit — neither derives a cap of its own.
export const sumCommitments = (pots: SavingsPot[], period: string): number =>
  Math.round(pots.reduce((total, pot) => total + potRate(pot, period), 0) * 100) / 100;

// Cap = Forecast Income − sum(Commitments). The single ceiling on the sum of
// all Category Limits. A non-positive Cap is never spent through: callers
// refuse the change that produced it rather than proposing degenerate limits.
export const computeCap = ({
  forecastIncome,
  pots,
  period,
}: {
  forecastIncome: number;
  pots: SavingsPot[];
  period: string;
}): number => Math.round((forecastIncome - sumCommitments(pots, period)) * 100) / 100;

// The Savings Goal as a derived read-model (ADR-0013): what the user is
// committed to setting aside this Period. Displayed, never stored, never set.
export const savingsGoal = sumCommitments;
