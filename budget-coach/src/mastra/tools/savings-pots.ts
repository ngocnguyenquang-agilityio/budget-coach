import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { computeCap } from "@/domain/commitment";
import { computeRefit } from "@/domain/refit";
import {
  SavingsPotSchema,
  computePotProgress,
  potRate,
  type SavingsPot,
} from "@/domain/savings-pot";
import { loadBudgetContext } from "@/mastra/lib/budget-context";
import { withToolErrorHandling } from "@/mastra/tools/with-tool-error-handling";
import { addTransaction, deleteTransaction } from "@/db/transactions";

// Every pot tool returns { message } for the Coach to relay, plus { pot } on
// success for the chat render card, plus { refitNeeded } when the change made
// the current Category Limits exceed the new Cap — the Coach's cue to call
// refitBudget (ADR-0014: the ledger changing is what triggers a refit).
// { success: false } stays reserved for the withToolErrorHandling throw path.
const outputSchema = z.object({
  message: z.string(),
  pot: SavingsPotSchema.optional(),
  refitNeeded: z.boolean().optional(),
});

// Pots are keyed by name, case-insensitively (CONTEXT.md, "Savings Pot").
const findPot = (pots: SavingsPot[], name: string): SavingsPot | undefined =>
  pots.find((pot) => pot.name.toLowerCase() === name.trim().toLowerCase());

const money = (value: number): string => `$${value.toFixed(2)}`;

// A pot whose rate would drive the Cap to zero or below is refused outright
// rather than saved (ADR-0014). The threshold is the Cap, not "the cuts look
// big": a merely painful refit still goes to the user so they can decline it.
//
// Only enforceable once income is on record: with none there is nothing to
// measure the claim against, and refusing a new user's first pot because they
// have not logged a paycheck yet would be nonsense.
const wouldLeaveNothing = (
  pots: SavingsPot[],
  forecastIncome: number,
  period: string,
  rate: number
): boolean =>
  rate > 0 && forecastIncome > 0 && computeCap({ forecastIncome, pots, period }) <= 0;

const refitVerdict = (
  pots: SavingsPot[],
  forecastIncome: number,
  categoryLimits: Parameters<typeof computeRefit>[0]["categoryLimits"],
  period: string
) => computeRefit({ forecastIncome, pots, categoryLimits, period });

export const createSavingsPotTool = createTool({
  id: "create-savings-pot",
  description:
    "Create a savings pot — the single way the user puts money toward something. Either target-driven (a target amount, optionally by a YYYY-MM deadline, e.g. a 'Laptop' pot of $1,200 by 2026-03) or rate-driven (a fixed amount per month, open-ended). A pot with a deadline or a rate claims part of the user's income, so it can shrink category limits.",
  inputSchema: z
    .object({
      name: z.string().min(1).max(60),
      targetAmount: z.number().positive().optional(),
      deadline: z.string().optional().describe("YYYY-MM; only meaningful with targetAmount"),
      ratePerMonth: z.number().positive().optional().describe("For an open-ended 'save $X a month' pot"),
    })
    .refine((value) => value.targetAmount !== undefined || value.ratePerMonth !== undefined, {
      message: "Provide either targetAmount (a thing to save for) or ratePerMonth (a recurring amount).",
    }),
  outputSchema,
  execute: withToolErrorHandling(async ({ name, targetAmount, deadline, ratePerMonth }, context) => {
    const { current, save, pots, period, forecastIncome, categoryLimits } = await loadBudgetContext(context);

    if (findPot(pots, name)) {
      return { message: `A savings pot named "${name.trim()}" already exists.` };
    }

    const pot: SavingsPot =
      targetAmount !== undefined
        ? {
            id: randomUUID(),
            kind: "target",
            name: name.trim(),
            targetAmount,
            balance: 0,
            ...(deadline ? { deadline } : {}),
          }
        : { id: randomUUID(), kind: "rate", name: name.trim(), ratePerMonth: ratePerMonth!, balance: 0 };

    const next = [...pots, pot];
    const rate = potRate(pot, period);

    if (wouldLeaveNothing(next, forecastIncome, period, rate)) {
      return {
        message: `That pot would need ${money(rate)}/mo, which doesn't leave anything to live on against income of ${money(forecastIncome)}. Try a later deadline or a smaller target.`,
      };
    }

    await save({ ...current, savingsPots: next });

    const verdict = refitVerdict(next, forecastIncome, categoryLimits, period);
    const rateNote = rate > 0 ? ` That's ${money(rate)}/mo.` : " It has no deadline, so it won't claim any of your budget yet.";

    return {
      message: `Created the "${pot.name}" pot.${rateNote}`,
      pot,
      refitNeeded: verdict.outcome === "cuts",
    };
  }),
});

export const updateSavingsPotTool = createTool({
  id: "update-savings-pot",
  description:
    "Update a savings pot: rename it, or change its target amount, deadline, or monthly rate. Identify the pot by its current name. Pass an empty string as newDeadline to clear a deadline.",
  inputSchema: z.object({
    name: z.string().min(1),
    newName: z.string().min(1).max(60).optional(),
    newTarget: z.number().positive().optional(),
    newDeadline: z.string().optional(),
    newRatePerMonth: z.number().positive().optional(),
  }),
  outputSchema,
  execute: withToolErrorHandling(
    async ({ name, newName, newTarget, newDeadline, newRatePerMonth }, context) => {
      const { current, save, pots, period, forecastIncome, categoryLimits } = await loadBudgetContext(context);
      const existing = findPot(pots, name);

      if (!existing) {
        return { message: `You don't have a savings pot named "${name.trim()}" yet.` };
      }

      const clash = newName ? findPot(pots, newName) : undefined;
      if (clash && clash.id !== existing.id) {
        return { message: `A savings pot named "${newName!.trim()}" already exists.` };
      }

      const renamed = newName ? { name: newName.trim() } : {};
      const pot: SavingsPot =
        existing.kind === "target"
          ? {
              ...existing,
              ...renamed,
              ...(newTarget !== undefined ? { targetAmount: newTarget } : {}),
              ...(newDeadline !== undefined ? { deadline: newDeadline || undefined } : {}),
            }
          : {
              ...existing,
              ...renamed,
              ...(newRatePerMonth !== undefined ? { ratePerMonth: newRatePerMonth } : {}),
            };

      const next = pots.map((entry) => (entry.id === pot.id ? pot : entry));
      const rate = potRate(pot, period);

      if (wouldLeaveNothing(next, forecastIncome, period, rate)) {
        return {
          message: `That change would need ${money(rate)}/mo, which doesn't leave anything to live on against income of ${money(forecastIncome)}. Try a later deadline or a smaller target.`,
        };
      }

      await save({ ...current, savingsPots: next });
      const verdict = refitVerdict(next, forecastIncome, categoryLimits, period);

      return {
        message: `Updated the "${pot.name}" pot${rate > 0 ? ` — now ${money(rate)}/mo` : ""}.`,
        pot,
        refitNeeded: verdict.outcome === "cuts",
      };
    }
  ),
});

export const deleteSavingsPotTool = createTool({
  id: "delete-savings-pot",
  description:
    "Delete a savings pot. Whatever it holds returns to the user's unallocated savings — the money isn't lost.",
  inputSchema: z.object({ name: z.string().min(1) }),
  outputSchema: z.object({ message: z.string() }),
  execute: withToolErrorHandling(async ({ name }, context) => {
    const { current, save, pots, unallocated, resourceId } = await loadBudgetContext(context);
    const existing = findPot(pots, name);

    if (!existing) {
      return { message: `You don't have a savings pot named "${name.trim()}" yet.` };
    }

    // Record the transfer before mutating working memory: if addTransaction
    // fails, the pot deletion never gets saved, so there's nothing to roll back.
    const recorded =
      existing.balance > 0
        ? await addTransaction({
            resourceId,
            merchant: existing.name,
            amount: existing.balance,
            type: "transfer",
            transferDirection: "from_pot",
            category: null,
            seedCategory: null,
            date: new Date().toISOString().slice(0, 10),
            status: "received",
          })
        : null;

    try {
      // Its balance is real money inside the Savings Balance — returning it to
      // Unallocated keeps the Balance unchanged (ADR-0013).
      await save({
        ...current,
        savingsPots: pots.filter((pot) => pot.id !== existing.id),
        unallocated: Math.round((unallocated + existing.balance) * 100) / 100,
      });
    } catch (error) {
      // save() failed after the transaction was recorded — delete it so the
      // ledger doesn't show money moving that never actually moved.
      if (recorded) await deleteTransaction(resourceId, recorded.id);
      throw error;
    }

    return {
      message:
        existing.balance > 0
          ? `Deleted the "${existing.name}" pot — its ${money(existing.balance)} went back to your unallocated savings.`
          : `Deleted the "${existing.name}" pot.`,
    };
  }),
});

export const allocateToPotTool = createTool({
  id: "allocate-to-pot",
  description:
    "Move money the user has already saved from their unallocated savings into a named pot. Use when they ask to put existing savings toward something — NOT when they describe earning or spending money, which are transactions.",
  inputSchema: z.object({ name: z.string().min(1), amount: z.number().positive() }),
  outputSchema,
  execute: withToolErrorHandling(async ({ name, amount }, context) => {
    const { current, save, pots, unallocated, period, resourceId } = await loadBudgetContext(context);
    const existing = findPot(pots, name);

    if (!existing) {
      return { message: `You don't have a savings pot named "${name.trim()}" yet.` };
    }

    if (amount > unallocated) {
      return {
        message: `You only have ${money(Math.max(0, unallocated))} unallocated, so I can't move ${money(amount)} into "${existing.name}". Savings build up at your monthly review.`,
      };
    }

    // Never overshoot a target — the excess stays unallocated.
    const room = existing.kind === "target" ? Math.max(0, existing.targetAmount - existing.balance) : Infinity;
    const moved = Math.round(Math.min(amount, room) * 100) / 100;

    if (moved <= 0) {
      return { message: `"${existing.name}" has already reached its target.` };
    }

    const pot: SavingsPot = { ...existing, balance: Math.round((existing.balance + moved) * 100) / 100 };

    // Record the transfer before mutating working memory: if addTransaction
    // fails, the pot/unallocated change never gets saved, so there's nothing to roll back.
    const recorded = await addTransaction({
      resourceId,
      merchant: pot.name,
      amount: moved,
      type: "transfer",
      transferDirection: "to_pot",
      category: null,
      seedCategory: null,
      date: new Date().toISOString().slice(0, 10),
      status: "received",
    });

    try {
      await save({
        ...current,
        savingsPots: pots.map((entry) => (entry.id === pot.id ? pot : entry)),
        unallocated: Math.round((unallocated - moved) * 100) / 100,
      });
    } catch (error) {
      // save() failed after the transaction was recorded — delete it so the
      // ledger doesn't show money moving that never actually moved.
      await deleteTransaction(resourceId, recorded.id);
      throw error;
    }

    const progress = computePotProgress(pot, period);
    return {
      message:
        progress.status === "complete"
          ? `Moved ${money(moved)} into "${pot.name}" — that reaches its ${money(pot.kind === "target" ? pot.targetAmount : 0)} target! 🎉`
          : `Moved ${money(moved)} into "${pot.name}" — now holding ${money(pot.balance)}.`,
      pot,
    };
  }),
});
