import { z } from "zod";
import { CategorySchema } from "./categories";

// The Coach's resource-scoped working memory shape — the only state that
// survives across threads for a given browser (per CLAUDE.md's Working
// memory schema). Transactions themselves live in LibSQL, not here.
export const BudgetStateSchema = z.object({
  savingsGoal: z.number().optional(),
  // partialRecord, not record — Zod v4's z.record with an enum key schema
  // requires every enum key present, which rejects the common case of only
  // a few categories having limits set.
  categoryLimits: z.partialRecord(CategorySchema, z.number()).optional(),
  lastReviewDate: z.string().optional(),
  pendingApproval: z.unknown().optional(),
});

export type BudgetState = z.infer<typeof BudgetStateSchema>;
