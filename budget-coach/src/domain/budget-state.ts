import { z } from "zod";
import { CategorySchema } from "./categories";

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

// The Coach's resource-scoped working memory shape — the only state that
// survives across threads for a given browser (per CLAUDE.md's Working
// memory schema). Transactions themselves live in LibSQL, not here.
export const BudgetStateSchema = z.object({
  savingsGoal: z.number().optional(),
  // Explicit, never inferred from summed Income transactions — see
  // docs/adr/0007-category-limits-capped-by-declared-income-and-savings-goal.md.
  declaredIncome: z.number().optional(),
  // YYYY-MM — stamped the moment a >20% drift offer is surfaced, so it fires
  // at most once per Period regardless of how the user responds.
  incomeDriftOfferedPeriod: z.string().optional(),
  // partialRecord, not record — Zod v4's z.record with an enum key schema
  // requires every enum key present, which rejects the common case of only
  // a few categories having limits set.
  categoryLimits: z.partialRecord(CategorySchema, z.number()).optional(),
  // YYYY-MM — only ever compared at Period granularity, never a full date.
  lastReviewPeriod: z.string().optional(),
  // Set while a Monthly Review is Pending Approval; cleared once decided.
  pendingApproval: z.object({ runId: z.string() }).optional(),
  coachPreferences: CoachPreferencesSchema.optional(),
});

export type BudgetState = z.infer<typeof BudgetStateSchema>;
