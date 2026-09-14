import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema, type CategoryLimits } from "@/domain/categories";
import { TransactionStatusSchema } from "@/domain/transaction";
import { addTransaction, listTransactions, type Transaction } from "@/db/transactions";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { parsePots } from "@/mastra/lib/budget-context";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";
import { parseAmendments } from "@/domain/budget-state";
import { computeAnalysis } from "@/domain/analysis";
import { periodOf } from "@/domain/period";
import { traceToolError, traceToolEvent } from "@/mastra/tools/with-tool-error-handling";

// Pot transfers aren't income or an expense (ADR-0013) and are never
// user-added, so they're filtered out of every agent-facing transaction
// list rather than widening this schema to a type the Coach never needs to
// reason about. The dashboard's own history view reads the DB directly and
// does see them.
const isFinancialTransaction = (
  transaction: Transaction
): transaction is Transaction & { type: "income" | "expense" } => transaction.type !== "transfer";

const TransactionSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  date: z.string(),
  createdAt: z.string(),
  merchant: z.string(),
  amount: z.number(),
  type: z.enum(["income", "expense"]),
  category: CategorySchema.nullable(),
  seedCategory: CategorySchema.nullable(),
  status: TransactionStatusSchema,
  fundedByPotId: z.string().nullable(),
  scheduleId: z.string().nullable(),
});

export const listTransactionsTool = createTool({
  id: "list-transactions",
  description:
    "List transactions for the current user, most recent first. Optionally filter to a single category and/or a month, e.g. to answer 'what did I spend on groceries this month'. Results include both confirmed transactions and expected (unconfirmed) ones — check each item's status.",
  inputSchema: z.object({
    category: CategorySchema.optional(),
    month: z.string().optional().describe("ISO month (YYYY-MM) to filter transactions to; omit for all months"),
  }),
  outputSchema: z.object({ transactions: z.array(TransactionSchema), error: z.string().optional() }),
  execute: async ({ category, month }, context) => {
    const resourceId = resolveResourceId(context);
    try {
      const transactions = await listTransactions(resourceId);
      const filtered = transactions
        .filter(isFinancialTransaction)
        .filter(
          (transaction) =>
            (category === undefined || transaction.category === category) &&
            (month === undefined || transaction.date.startsWith(month))
        );
      return { transactions: filtered };
    } catch (err) {
      // Whole tool failed; the empty-list return would otherwise look successful.
      traceToolError(context, err, "LIST_TRANSACTIONS_FAILED");
      return { transactions: [], error: "Couldn't load your transactions right now." };
    }
  },
});

export const AddTransactionItemSchema = z
  .object({
    merchant: z.string(),
    amount: z.number().positive(),
    type: z.enum(["income", "expense"]),
    category: CategorySchema.optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be an ISO date (YYYY-MM-DD)")
      .optional()
      .describe("ISO date (YYYY-MM-DD); defaults to today"),
    // ADR-0012: an Expense paid out of a Savings Pot debits that pot and is
    // excluded from Net Savings, because the money was saved in an earlier
    // Period and already sits in the Savings Balance.
    fundedByPot: z.string().optional().describe("Name of the savings pot this expense was paid out of"),
  })
  .refine((value) => (value.type === "expense" ? value.category !== undefined : value.category === undefined), {
    message: "category is required for expenses and must be omitted for income",
  })
  .refine((value) => value.type === "expense" || value.fundedByPot === undefined, {
    message: "only an expense can be funded by a savings pot",
  });

export const addTransactionsTool = createTool({
  id: "add-transactions",
  description:
    "Record one or more transactions for the current user in a single batch (e.g. when the user describes several purchases in one message). Each item takes a type of \"income\" or \"expense\"; category is required for expenses and must be omitted for income; date is optional and defaults to today. Set fundedByPot on an expense the user paid for out of a named savings pot.",
  inputSchema: z.object({ transactions: z.array(AddTransactionItemSchema) }),
  outputSchema: z.object({
    transactions: z.array(TransactionSchema),
    // Items that failed to insert (e.g. a DB error partway through the batch)
    // — surfaced so the Coach never tells the user something was recorded
    // when it wasn't, and can say exactly which rows landed.
    failed: z
      .array(z.object({ merchant: z.string(), amount: z.number(), error: z.string() }))
      .optional(),
    // Pots debited by this batch, so the Coach can report the new balances.
    potDraws: z.array(z.object({ potName: z.string(), amount: z.number(), balance: z.number() })).optional(),
    // Closed months this batch changed; their savings correction applies at
    // the next Monthly Review (ADR-0015) — never a refit, since only
    // Unallocated moves, not a pot rate or the Cap.
    amendedPeriods: z.array(z.string()).optional(),
  }),
  execute: async ({ transactions: items }, context) => {
    const resourceId = resolveResourceId(context);
    const today = new Date().toISOString().slice(0, 10);

    // Resolve pot names up front so a typo fails before anything is written.
    const threadId = context.agent?.threadId;
    const coachAgent = context.mastra?.getAgent("coach");
    const memory = coachAgent ? await coachAgent.getMemory() : undefined;
    const raw = threadId && memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const state = parseWorkingMemory(raw);
    let pots = parsePots(state.savingsPots);

    // A Transaction dated in an already-closed Period needs its close
    // amended, not silently ignored (ADR-0015). The baseline must be read
    // BEFORE anything is inserted: at this instant a period's Net Savings is
    // exactly what was rolled up when it closed.
    const lastClosed = typeof state.lastClosedPeriod === "string" ? state.lastClosedPeriod : undefined;
    const existingAmendments = parseAmendments(state.pendingAmendments);
    // YYYY-MM sorts lexicographically, so a plain <= is a correct Period compare.
    const backdatedPeriods = lastClosed
      ? [...new Set(items.map((item) => periodOf(item.date ?? today)))].filter(
          (period) => period <= lastClosed && !existingAmendments.some((entry) => entry.period === period)
        )
      : [];

    let baselines = new Map<string, number>();
    if (backdatedPeriods.length > 0) {
      const before = await listTransactions(resourceId);
      const limits = (state.categoryLimits as CategoryLimits | undefined) ?? {};
      baselines = new Map(
        backdatedPeriods.map((period) => [period, computeAnalysis(before, limits, period).netSavings])
      );
    }

    const inserted: (Transaction & { type: "income" | "expense" })[] = [];
    const failed: { merchant: string; amount: number; error: string }[] = [];
    const draws = new Map<string, { potName: string; amount: number; balance: number }>();

    for (const item of items) {
      const pot = item.fundedByPot
        ? pots.find((entry) => entry.name.toLowerCase() === item.fundedByPot!.trim().toLowerCase())
        : undefined;

      if (item.fundedByPot && !pot) {
        failed.push({
          merchant: item.merchant,
          amount: item.amount,
          error: `No savings pot named "${item.fundedByPot}".`,
        });
        continue;
      }

      if (pot && pot.balance < item.amount) {
        failed.push({
          merchant: item.merchant,
          amount: item.amount,
          error: `"${pot.name}" only holds $${pot.balance.toFixed(2)}.`,
        });
        continue;
      }

      try {
        const row = await addTransaction({
          resourceId,
          merchant: item.merchant,
          amount: item.amount,
          type: item.type,
          category: item.category ?? null,
          date: item.date ?? today,
          seedCategory: null,
          status: "received",
          fundedByPotId: pot?.id ?? null,
        });
        // addTransaction's return type is the DB's full Transaction union, but
        // this call always passes item.type ("income" | "expense" per
        // AddTransactionItemSchema), so the row can never actually be a transfer.
        inserted.push(row as Transaction & { type: "income" | "expense" });

        if (pot) {
          const balance = Math.round((pot.balance - item.amount) * 100) / 100;
          pots = pots.map((entry) => (entry.id === pot.id ? { ...entry, balance } : entry));
          const existing = draws.get(pot.id);
          draws.set(pot.id, {
            potName: pot.name,
            amount: (existing?.amount ?? 0) + item.amount,
            balance,
          });
        }
      } catch (err) {
        // Event span, not span.error() — the batch can still partly succeed.
        traceToolEvent(context, err, `add-transactions item failed: ${item.merchant}`, "ADD_TRANSACTION_ITEM_FAILED");
        failed.push({
          merchant: item.merchant,
          amount: item.amount,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Only periods that actually landed a row get flagged — a row that
    // failed to insert never touched that period's ledger.
    const amendedPeriods = [
      ...new Set(inserted.filter((row) => baselines.has(periodOf(row.date))).map((row) => periodOf(row.date))),
    ];
    const nextAmendments = [
      ...existingAmendments,
      ...amendedPeriods.map((period) => ({ period, netSavingsAtClose: baselines.get(period)! })),
    ];

    // Persist pot draws and/or amendment flags once, after the batch, so a
    // partial failure can't leave a pot debited (or a period flagged) for a
    // row that never landed.
    if ((draws.size > 0 || amendedPeriods.length > 0) && threadId && memory) {
      await memory.updateWorkingMemory({
        threadId,
        resourceId,
        workingMemory: JSON.stringify({
          ...state,
          ...(draws.size > 0 ? { savingsPots: pots } : {}),
          ...(amendedPeriods.length > 0 ? { pendingAmendments: nextAmendments } : {}),
        }),
      });
    }

    return {
      transactions: inserted,
      ...(failed.length > 0 ? { failed } : {}),
      ...(draws.size > 0 ? { potDraws: [...draws.values()] } : {}),
      ...(amendedPeriods.length > 0 ? { amendedPeriods } : {}),
    };
  },
});
