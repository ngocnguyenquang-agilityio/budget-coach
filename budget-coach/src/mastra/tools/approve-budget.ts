import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Stub only — ticket 04 replaces this with the real suspend/resume wiring
// against monthlyReviewWorkflow's approvalGate (`suspendSchema`/`resumeSchema`,
// `return suspend(...)`, never `await suspend()`).
export const approveBudgetTool = createTool({
  id: "approve-budget",
  description: "Approve or reject proposed category limit adjustments from a Monthly Review.",
  inputSchema: z.object({}),
  outputSchema: z.object({ message: z.string() }),
  execute: async () => ({
    message: "Monthly Review approval isn't wired up yet — check back after ticket 04.",
  }),
});
