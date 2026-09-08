import type { Category } from "./categories";
import { computeCap } from "./commitment";
import { scaleLimitsToCap } from "./propose-limits";
import type { SavingsPot } from "./savings-pot";

type CategoryLimits = Partial<Record<Category, number>>;

// Discriminated on `outcome`:
// - "impossible": the Cap would be zero or negative — Commitments meet or
//   exceed Forecast Income. The caller refuses the change that produced it
//   rather than proposing degenerate limits (ADR-0014). Note the threshold is
//   `cap <= 0`, NOT "the cuts are large": a merely painful refit still goes to
//   the user so they can see it and decline.
// - "fits": current Category Limits already sit within the Cap — nothing to
//   propose, nothing to approve.
// - "cuts": limits exceed the Cap and are scaled down proportionally.
export type Refit =
  | { outcome: "impossible"; cap: number; forecastIncome: number; commitments: number }
  | { outcome: "fits"; cap: number; headroom: number }
  | { outcome: "cuts"; cap: number; committed: number; proposedLimits: CategoryLimits };

// The forward-looking calculation, run whenever the Commitment ledger changes
// (ADR-0014) — a pot created, a rate or deadline changed, income revised, or a
// Period boundary crossed (target pots re-derive their rates, so the Cap moves
// on its own even with no user edit).
//
// Unlike the Capacity model it replaces, this derives no cap of its own: it
// calls computeCap, the same function the Monthly Review uses.
export const computeRefit = ({
  forecastIncome,
  pots,
  categoryLimits,
  period,
}: {
  forecastIncome: number;
  pots: SavingsPot[];
  categoryLimits: CategoryLimits;
  period: string;
}): Refit => {
  const cap = computeCap({ forecastIncome, pots, period });
  const commitments = Math.round((forecastIncome - cap) * 100) / 100;

  if (cap <= 0) {
    return { outcome: "impossible", cap, forecastIncome, commitments };
  }

  const committed = Object.values(categoryLimits).reduce((total, value) => total + (value ?? 0), 0);

  if (committed <= cap) {
    return { outcome: "fits", cap, headroom: Math.round((cap - committed) * 100) / 100 };
  }

  return { outcome: "cuts", cap, committed, proposedLimits: scaleLimitsToCap(categoryLimits, cap) };
};
