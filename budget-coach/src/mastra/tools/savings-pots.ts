import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { SavingsPotSchema, type SavingsPot } from "@/domain/savings-pot";
import { openBudgetState } from "@/mastra/lib/coach-working-memory";
import { withToolErrorHandling } from "@/mastra/tools/with-tool-error-handling";

// Every pot tool returns { message } for the Coach to relay, plus { pot } on
// success for the chat render card (matches plan-funding.ts's message-based
// soft-failure convention — { success: false } is reserved for the
// withToolErrorHandling throw path).
const outputSchema = z.object({
  message: z.string(),
  pot: SavingsPotSchema.optional(),
});

const readPots = (current: Record<string, unknown>): SavingsPot[] =>
  (current.savingsPots as SavingsPot[] | undefined) ?? [];

// Pots are keyed by name, case-insensitively (CONTEXT.md, "Savings Pot").
const findPot = (pots: SavingsPot[], name: string): SavingsPot | undefined =>
  pots.find((pot) => pot.name.toLowerCase() === name.trim().toLowerCase());

export const createSavingsPotTool = createTool({
  id: "create-savings-pot",
  description:
    "Create a named savings pot that tracks cumulative progress toward a target amount (e.g. a 'Laptop' pot of $1,200), with an optional YYYY-MM deadline. A pot only tracks progress — it never changes category limits.",
  inputSchema: z.object({
    name: z.string().min(1).max(60),
    targetAmount: z.number().positive(),
    deadline: z.string().optional(),
  }),
  outputSchema,
  execute: withToolErrorHandling(async ({ name, targetAmount, deadline }, context) => {
    const { current, save } = await openBudgetState(context);
    const pots = readPots(current);

    if (findPot(pots, name)) {
      return { message: `A savings pot named "${name.trim()}" already exists.` };
    }

    const pot: SavingsPot = {
      id: randomUUID(),
      name: name.trim(),
      targetAmount,
      savedSoFar: 0,
      ...(deadline ? { deadline } : {}),
    };
    await save({ ...current, savingsPots: [...pots, pot] });

    return {
      message: `Created the "${pot.name}" savings pot with a $${targetAmount.toFixed(2)} target${
        deadline ? ` by ${deadline}` : ""
      }.`,
      pot,
    };
  }),
});

export const contributeToPotTool = createTool({
  id: "contribute-to-pot",
  description:
    "Add an amount to a named savings pot's running balance when the user says they've set money aside toward it (e.g. 'I put $400 toward my laptop pot').",
  inputSchema: z.object({
    name: z.string().min(1),
    amount: z.number().positive(),
  }),
  outputSchema,
  execute: withToolErrorHandling(async ({ name, amount }, context) => {
    const { current, save } = await openBudgetState(context);
    const pots = readPots(current);
    const existing = findPot(pots, name);

    if (!existing) {
      return { message: `You don't have a savings pot named "${name.trim()}" yet.` };
    }

    const pot: SavingsPot = { ...existing, savedSoFar: existing.savedSoFar + amount };
    await save({
      ...current,
      savingsPots: pots.map((p) => (p.id === pot.id ? pot : p)),
    });

    const reached = pot.savedSoFar >= pot.targetAmount;
    return {
      message: reached
        ? `Added $${amount.toFixed(2)} to "${pot.name}" — that reaches your $${pot.targetAmount.toFixed(2)} target! 🎉`
        : `Added $${amount.toFixed(2)} to "${pot.name}" — now at $${pot.savedSoFar.toFixed(2)} of $${pot.targetAmount.toFixed(2)}.`,
      pot,
    };
  }),
});

export const updateSavingsPotTool = createTool({
  id: "update-savings-pot",
  description:
    "Update a savings pot: rename it, or change its target amount or deadline. Identify the pot by its current name.",
  inputSchema: z.object({
    name: z.string().min(1),
    newName: z.string().min(1).max(60).optional(),
    newTarget: z.number().positive().optional(),
    // Pass an empty string to clear an existing deadline.
    newDeadline: z.string().optional(),
  }),
  outputSchema,
  execute: withToolErrorHandling(async ({ name, newName, newTarget, newDeadline }, context) => {
    const { current, save } = await openBudgetState(context);
    const pots = readPots(current);
    const existing = findPot(pots, name);

    if (!existing) {
      return { message: `You don't have a savings pot named "${name.trim()}" yet.` };
    }

    if (newName && findPot(pots, newName) && findPot(pots, newName)!.id !== existing.id) {
      return { message: `A savings pot named "${newName.trim()}" already exists.` };
    }

    const pot: SavingsPot = {
      ...existing,
      ...(newName ? { name: newName.trim() } : {}),
      ...(newTarget !== undefined ? { targetAmount: newTarget } : {}),
      ...(newDeadline !== undefined ? { deadline: newDeadline || undefined } : {}),
    };
    await save({
      ...current,
      savingsPots: pots.map((p) => (p.id === pot.id ? pot : p)),
    });

    return { message: `Updated the "${pot.name}" savings pot.`, pot };
  }),
});

export const deleteSavingsPotTool = createTool({
  id: "delete-savings-pot",
  description: "Delete a named savings pot.",
  inputSchema: z.object({ name: z.string().min(1) }),
  outputSchema: z.object({ message: z.string() }),
  execute: withToolErrorHandling(async ({ name }, context) => {
    const { current, save } = await openBudgetState(context);
    const pots = readPots(current);
    const existing = findPot(pots, name);

    if (!existing) {
      return { message: `You don't have a savings pot named "${name.trim()}" yet.` };
    }

    await save({ ...current, savingsPots: pots.filter((p) => p.id !== existing.id) });
    return { message: `Deleted the "${existing.name}" savings pot.` };
  }),
});
