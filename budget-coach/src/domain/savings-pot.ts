import { z } from "zod";
import { monthDiff } from "./funding-plan";

// A named, cumulative progress tracker toward a fixed target (see CONTEXT.md,
// "Savings Pot", and ADR-0010). Pure projection: `savedSoFar` is a
// self-reported running balance, never derived from Transactions, and a Pot
// never constrains Category Limits. Keyed by name (case-insensitive) in the
// Coach's working memory.
export const SavingsPotSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  targetAmount: z.number().positive(),
  // YYYY-MM. Absent means open-ended — track balance vs. target, no per-month
  // figure.
  deadline: z.string().optional(),
  savedSoFar: z.number().min(0),
});

export type SavingsPot = z.infer<typeof SavingsPotSchema>;

// Derived, never persisted — computed against the current Period.
// - "complete": `savedSoFar` has reached the target.
// - "behind": a deadline that has already passed while still short.
// - "onTrack": everything else (including open-ended pots).
export type PotStatus = "onTrack" | "complete" | "behind";

export interface PotProgress {
  pct: number; // 0–100, clamped
  remaining: number; // targetAmount − savedSoFar, floored at 0
  status: PotStatus;
  // Only when a deadline is set and the pot isn't complete: the per-month
  // set-aside needed to reach the target by the deadline (reuses the
  // Funding Plan month math).
  requiredPerMonth?: number;
}

export const computePotProgress = (pot: SavingsPot, period: string): PotProgress => {
  const remaining = Math.max(0, pot.targetAmount - pot.savedSoFar);
  const pct = Math.min(100, Math.round((pot.savedSoFar / pot.targetAmount) * 100));

  if (remaining === 0) {
    return { pct: 100, remaining: 0, status: "complete" };
  }

  if (pot.deadline) {
    // +1 so a deadline in the current Period still counts as one month to save.
    const monthsRemaining = monthDiff(period, pot.deadline) + 1;
    if (monthsRemaining <= 0) {
      return { pct, remaining, status: "behind", requiredPerMonth: remaining };
    }
    const requiredPerMonth = Math.round((remaining / monthsRemaining) * 100) / 100;
    return { pct, remaining, status: "onTrack", requiredPerMonth };
  }

  return { pct, remaining, status: "onTrack" };
};
