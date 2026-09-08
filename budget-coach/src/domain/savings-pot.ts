import { z } from "zod";
import { monthDiff } from "./period";

// A Savings Pot is the single way a user says "I'm putting money toward
// something" (ADR-0013). It holds part of the real Savings Balance — `balance`
// grows only through allocation from Unallocated at Period Close, and falls
// only when an Expense names the pot. It is never self-reported.
//
// Two shapes, discriminated on `kind`:

// Target-driven: an amount, optionally by a deadline. Its rate is re-derived
// every Period as remaining ÷ months left, so falling behind *raises* the
// required monthly figure instead of hiding the shortfall.
export const TargetPotSchema = z.object({
  id: z.string(),
  kind: z.literal("target"),
  name: z.string().min(1).max(60),
  targetAmount: z.number().positive(),
  // YYYY-MM. Absent means open-ended: the pot claims no headroom (see
  // potRate) and is funded by whatever Unallocated has spare.
  deadline: z.string().optional(),
  balance: z.number().min(0),
});

// Rate-driven: an explicit amount per month, open-ended, no target. This is
// what "save $500 a month" becomes, via the General Savings pot.
export const RatePotSchema = z.object({
  id: z.string(),
  kind: z.literal("rate"),
  name: z.string().min(1).max(60),
  ratePerMonth: z.number().positive(),
  balance: z.number().min(0),
});

export const SavingsPotSchema = z.discriminatedUnion("kind", [TargetPotSchema, RatePotSchema]);

export type TargetPot = z.infer<typeof TargetPotSchema>;
export type RatePot = z.infer<typeof RatePotSchema>;
export type SavingsPot = z.infer<typeof SavingsPotSchema>;

// The name of the default rate-driven pot, created when a user states a
// savings rate without naming a destination ("save $500 a month"). Exists so
// nobody has to learn the word "pot" to save money (ADR-0013).
export const GENERAL_SAVINGS_POT = "General savings";

export const isComplete = (pot: SavingsPot): boolean =>
  pot.kind === "target" && pot.balance >= pot.targetAmount;

// A pot's current monthly rate — its Commitment against Forecast Income
// (ADR-0014). This is the ONLY place a rate is derived; the cap, the Period
// Close allocation and the progress card all read it from here.
//
// Zero for a completed pot (its claim is released) and for an open-ended
// target pot (no deadline means no months to divide by, so it claims nothing
// until the user gives it one).
export const potRate = (pot: SavingsPot, period: string): number => {
  if (pot.kind === "rate") return pot.ratePerMonth;
  if (isComplete(pot)) return 0;
  if (!pot.deadline) return 0;

  const remaining = pot.targetAmount - pot.balance;
  // +1 so a deadline in the current Period still counts as one month to save.
  const monthsRemaining = monthDiff(period, pot.deadline) + 1;

  // Deadline already passed and still short: the whole remainder is due now.
  if (monthsRemaining <= 0) return round(remaining);

  return round(remaining / monthsRemaining);
};

export type PotStatus = "onTrack" | "complete" | "behind" | "openEnded";

export interface PotProgress {
  // The pot's current Commitment — what it claims from Forecast Income.
  rate: number;
  balance: number;
  status: PotStatus;
  // Target-driven pots only.
  targetAmount?: number;
  remaining?: number;
  pct?: number;
}

// Derived, never persisted — computed against the current Period.
export const computePotProgress = (pot: SavingsPot, period: string): PotProgress => {
  const rate = potRate(pot, period);

  if (pot.kind === "rate") {
    return { rate, balance: pot.balance, status: "openEnded" };
  }

  const remaining = Math.max(0, pot.targetAmount - pot.balance);
  const pct = Math.min(100, Math.round((pot.balance / pot.targetAmount) * 100));
  const base = { rate, balance: pot.balance, targetAmount: pot.targetAmount, remaining, pct };

  if (remaining === 0) return { ...base, pct: 100, status: "complete" };
  if (!pot.deadline) return { ...base, status: "openEnded" };

  const monthsRemaining = monthDiff(period, pot.deadline) + 1;
  if (monthsRemaining <= 0) return { ...base, status: "behind" };

  return { ...base, status: "onTrack" };
};

const round = (value: number): number => Math.round(value * 100) / 100;

// Working memory is written by the model as well as by tools, and resources
// created before ADR-0013 hold pots in the old shape (`savedSoFar`, no
// `kind`). Coerce what we can, drop what we can't — a malformed pot must
// never take down a whole budget read.
export const parsePots = (value: unknown): SavingsPot[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): SavingsPot[] => {
    const parsed = SavingsPotSchema.safeParse(entry);
    if (parsed.success) return [parsed.data];

    // Legacy shape: a target pot with a self-reported balance.
    const legacy = entry as {
      id?: unknown;
      name?: unknown;
      targetAmount?: unknown;
      savedSoFar?: unknown;
      deadline?: unknown;
    };
    if (
      typeof legacy.id === "string" &&
      typeof legacy.name === "string" &&
      typeof legacy.targetAmount === "number"
    ) {
      const migrated = SavingsPotSchema.safeParse({
        id: legacy.id,
        kind: "target",
        name: legacy.name,
        targetAmount: legacy.targetAmount,
        balance: typeof legacy.savedSoFar === "number" ? legacy.savedSoFar : 0,
        ...(typeof legacy.deadline === "string" ? { deadline: legacy.deadline } : {}),
      });
      if (migrated.success) return [migrated.data];
    }

    return [];
  });
};
