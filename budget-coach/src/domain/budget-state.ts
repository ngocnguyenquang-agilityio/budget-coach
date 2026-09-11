import { z } from "zod";
import { CategorySchema } from "./categories";
import { SavingsPotSchema } from "./savings-pot";

// Explicit, resource-scoped adjustments to how the Coach communicates —
// never overrides a guardrail or suppresses required information (ADR-0006).
export const CoachPreferencesSchema = z.object({
  verbosity: z.enum(["concise", "detailed"]).optional(),
  // Capped at 50 chars — this value gets woven into the Coach's system
  // instructions (not just a user turn), so it's a higher-trust injection
  // surface than ordinary chat input (ADR-0006).
  nickname: z.string().max(50).optional(),
  emphasizedCategories: z.array(CategorySchema).optional(),
});

export type CoachPreferences = z.infer<typeof CoachPreferencesSchema>;

// A closed Period whose Net Savings has since been changed by a backdated
// Transaction, awaiting the next Monthly Review's amendment (ADR-0015).
export const PendingAmendmentSchema = z.object({
  period: z.string(),
  netSavingsAtClose: z.number(),
});

export type PendingAmendment = z.infer<typeof PendingAmendmentSchema>;

// The Coach's resource-scoped working memory shape — the only state that
// survives across threads for a given user. Transactions and Recurring
// Schedules live in LibSQL, not here.
//
// Deliberately absent (ADR-0011, ADR-0013): `declaredIncome` and
// `incomeDriftOfferedPeriod` (income is now the Transaction ledger itself)
// and `savingsGoal` (derived from Savings Pot rates, never stored).
export const BudgetStateSchema = z.object({
  // partialRecord, not record — Zod v4's z.record with an enum key schema
  // requires every enum key present, which rejects the common case of only
  // a few categories having limits set.
  categoryLimits: z.partialRecord(CategorySchema, z.number()).optional(),
  // YYYY-MM — only ever compared at Period granularity, never a full date.
  lastReviewPeriod: z.string().optional(),
  // YYYY-MM of the most recent Period whose Net Savings has been rolled into
  // the Savings Balance. A Monthly Review closes every Period after this one
  // (ADR-0012), so skipping a month defers the close rather than losing it.
  lastClosedPeriod: z.string().optional(),
  // The part of the Savings Balance not held by any pot. May go negative: an
  // overspent Period draws it down, and money already inside a pot is never
  // clawed back to cover it.
  unallocated: z.number().optional(),
  // Set while an approval is Pending Approval; cleared once decided. `workflow`
  // records which workflow owns the suspended run so the two tools' resume
  // paths don't collide (ADR-0008). At most one may be pending across both
  // workflows at a time.
  // Mastra's schema-based working memory lets the model clear a field by
  // setting it to `null` (merge semantics) — both this and `workflow` must
  // accept that shape or the model's own updateWorkingMemory tool call fails
  // validation whenever it tries to clear a resolved approval.
  pendingApproval: z
    .object({
      runId: z.string(),
      workflow: z.enum(["monthly-review", "refit"]).nullable().optional(),
    })
    .nullable()
    .optional(),
  coachPreferences: CoachPreferencesSchema.optional(),
  // Savings Pots (ADR-0013) — the single savings concept. Each holds part of
  // the real Savings Balance; every pot's rate is a Commitment. Keyed by name,
  // case-insensitive.
  savingsPots: z.array(SavingsPotSchema).optional(),
  // Periods already closed that have since had a Transaction backdated into
  // them. `netSavingsAtClose` is the figure rolled into the Savings Balance
  // at close time, captured just before the backdated insert — the next
  // Monthly Review diffs a fresh computeAnalysis against it and folds only
  // the difference into Unallocated (original pot allocations are not
  // replayed). An array, not a record: working-memory writes merge, so only
  // an array is reliably replaced when an entry is removed (ADR-0015).
  pendingAmendments: z.array(PendingAmendmentSchema).optional(),
});

export type BudgetState = z.infer<typeof BudgetStateSchema>;

// Savings Balance = every pot's balance plus whatever sits Unallocated
// (ADR-0012). Derived, never stored — storing both it and its parts invites
// them to disagree.
export const savingsBalance = (state: BudgetState): number => {
  const inPots = (state.savingsPots ?? []).reduce((total, pot) => total + pot.balance, 0);
  return Math.round((inPots + (state.unallocated ?? 0)) * 100) / 100;
};

// Defensive parse, same posture as parsePots (savings-pot.ts): a malformed
// or absent value must never take down a whole working-memory read.
export const parseAmendments = (value: unknown): PendingAmendment[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = PendingAmendmentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
};
