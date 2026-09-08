import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { computeCap } from "@/domain/commitment";
import { computeRefit } from "@/domain/refit";
import { GENERAL_SAVINGS_POT, type SavingsPot } from "@/domain/savings-pot";
import { loadBudgetContext } from "@/mastra/lib/budget-context";
import { withToolErrorHandling } from "@/mastra/tools/with-tool-error-handling";

// "Set my savings goal to $500" is a *shorthand*, not a stored field
// (ADR-0013): it creates or updates the rate-driven General Savings pot, so a
// user who just wants to save without a reason never has to learn the word
// "pot". The displayed Savings Goal is the derived sum of every pot's rate.
export const setSavingsGoalTool = createTool({
  id: "set-savings-goal",
  description:
    "Set how much the user wants to save each month without naming a destination. This maintains their General Savings pot. If they name something specific to save for, use createSavingsPot instead.",
  inputSchema: z.object({ savingsGoal: z.number().positive() }),
  outputSchema: z.object({
    message: z.string(),
    ratePerMonth: z.number().optional(),
    refitNeeded: z.boolean().optional(),
  }),
  execute: withToolErrorHandling(async ({ savingsGoal }, context) => {
    const { current, save, pots, period, forecastIncome, categoryLimits } = await loadBudgetContext(context);

    const existing = pots.find(
      (pot) => pot.name.toLowerCase() === GENERAL_SAVINGS_POT.toLowerCase()
    );

    const pot: SavingsPot =
      existing && existing.kind === "rate"
        ? { ...existing, ratePerMonth: savingsGoal }
        : {
            id: existing?.id ?? randomUUID(),
            kind: "rate",
            name: GENERAL_SAVINGS_POT,
            ratePerMonth: savingsGoal,
            balance: existing?.balance ?? 0,
          };

    const next = existing ? pots.map((entry) => (entry.id === pot.id ? pot : entry)) : [...pots, pot];

    // Refused rather than saved when it leaves nothing to live on (ADR-0014).
    // Only checkable once there is income on record — a new user naming a
    // savings amount before logging any income has nothing to check against,
    // and refusing them there would be nonsense.
    if (forecastIncome > 0 && computeCap({ forecastIncome, pots: next, period }) <= 0) {
      return {
        message: `Saving $${savingsGoal.toFixed(2)}/mo doesn't leave anything to live on against income of $${forecastIncome.toFixed(2)} — and your other pots already claim some of it. Try a smaller amount.`,
      };
    }

    await save({ ...current, savingsPots: next });
    const verdict = computeRefit({ forecastIncome, pots: next, categoryLimits, period });

    return {
      message: `Your general savings is set to $${savingsGoal.toFixed(2)} a month.`,
      ratePerMonth: savingsGoal,
      refitNeeded: verdict.outcome === "cuts",
    };
  }),
});
