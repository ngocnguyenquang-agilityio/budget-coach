import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { computeAnalysis } from "@/domain/analysis";
import { addTransaction, listTransactions } from "@/db/transactions";
import { resolveResourceId } from "@/mastra/get-resource-id";
import { parseWorkingMemory } from "@/mastra/parse-working-memory";

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
});

export const listTransactionsTool = createTool({
  id: "list-transactions",
  description:
    "List transactions for the current user, most recent first. Optionally filter to a single category and/or a month, e.g. to answer 'what did I spend on groceries this month'.",
  inputSchema: z.object({
    category: CategorySchema.optional(),
    month: z.string().optional().describe("ISO month (YYYY-MM) to filter transactions to; omit for all months"),
  }),
  outputSchema: z.object({ transactions: z.array(TransactionSchema) }),
  execute: async ({ category, month }, context) => {
    const resourceId = resolveResourceId(context);
    const transactions = await listTransactions(resourceId);
    const filtered = transactions.filter(
      (transaction) =>
        (category === undefined || transaction.category === category) &&
        (month === undefined || transaction.date.startsWith(month))
    );
    return { transactions: filtered };
  },
});

// Drift threshold (ADR-0007): how far the Period's actual accrued Income
// transactions must diverge from the stored Declared Income before the
// Coach is prompted to proactively offer an out-of-cycle Monthly Review.
const INCOME_DRIFT_THRESHOLD = 0.2;

export const addTransactionTool = createTool({
  id: "add-transaction",
  description: "Record a new transaction for the current user. category is required for expenses and must be omitted for income.",
  inputSchema: z
    .object({
      merchant: z.string(),
      amount: z.number(),
      type: z.enum(["income", "expense"]),
      category: CategorySchema.optional(),
      date: z.string().optional().describe("ISO date (YYYY-MM-DD); defaults to today"),
    })
    .refine((value) => (value.type === "expense" ? value.category !== undefined : value.category === undefined), {
      message: "category is required for expenses and must be omitted for income",
    }),
  outputSchema: TransactionSchema.extend({
    // Present only when this Income transaction pushed the Period's actual
    // income >20% away from the stored Declared Income, and only the first
    // time that happens in a given Period (see incomeDriftOfferedPeriod).
    incomeDrift: z
      .object({
        declaredIncome: z.number(),
        currentIncomeTotal: z.number(),
      })
      .optional(),
  }),
  execute: async ({ merchant, amount, type, category, date }, context) => {
    const resourceId = resolveResourceId(context);
    const transaction = await addTransaction({
      resourceId,
      merchant,
      amount,
      type,
      category: category ?? null,
      date: date ?? new Date().toISOString().slice(0, 10),
      seedCategory: null,
    });

    if (type !== "income") return transaction;

    const threadId = context.agent?.threadId;
    const coachAgent = context.mastra?.getAgent("coach");
    const memory = coachAgent ? await coachAgent.getMemory() : undefined;
    if (!threadId || !memory) return transaction;

    const raw = await memory.getWorkingMemory({ threadId, resourceId });
    const current = parseWorkingMemory(raw);
    const declaredIncome = current.declaredIncome as number | undefined;
    const period = new Date().toISOString().slice(0, 7);
    const offeredPeriod = current.incomeDriftOfferedPeriod as string | undefined;

    if (declaredIncome === undefined || offeredPeriod === period) return transaction;

    const transactions = await listTransactions(resourceId);
    const analysis = computeAnalysis(transactions, {}, period);
    const drift = Math.abs(analysis.incomeTotal - declaredIncome) / declaredIncome;

    if (drift <= INCOME_DRIFT_THRESHOLD) return transaction;

    // Stamp immediately, before the Coach ever relays this to the user — the
    // offer must fire at most once per Period regardless of how (or whether)
    // the user responds.
    await memory.updateWorkingMemory({
      threadId,
      resourceId,
      workingMemory: JSON.stringify({ ...current, incomeDriftOfferedPeriod: period }),
    });

    return { ...transaction, incomeDrift: { declaredIncome, currentIncomeTotal: analysis.incomeTotal } };
  },
});
