import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { computeAnalysis } from "@/domain/analysis";
import { addTransaction, listTransactions, type Transaction } from "@/db/transactions";
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

export const AddTransactionItemSchema = z
  .object({
    merchant: z.string(),
    amount: z.number(),
    type: z.enum(["income", "expense"]),
    category: CategorySchema.optional(),
    date: z.string().optional().describe("ISO date (YYYY-MM-DD); defaults to today"),
  })
  .refine((value) => (value.type === "expense" ? value.category !== undefined : value.category === undefined), {
    message: "category is required for expenses and must be omitted for income",
  });

export const addTransactionsTool = createTool({
  id: "add-transactions",
  description:
    "Record one or more transactions for the current user in a single batch (e.g. when the user describes several purchases in one message). Each item takes a type of \"income\" or \"expense\"; category is required for expenses and must be omitted for income; date is optional and defaults to today.",
  inputSchema: z.object({ transactions: z.array(AddTransactionItemSchema) }),
  outputSchema: z.object({
    transactions: z.array(TransactionSchema),
    // At most one incomeDrift for the whole batch (not one per income row):
    // present only when the batch pushed the Period's actual income >20% away
    // from the stored Declared Income, and only the first time that happens in
    // a given Period (see incomeDriftOfferedPeriod).
    incomeDrift: z
      .object({
        declaredIncome: z.number(),
        currentIncomeTotal: z.number(),
      })
      .optional(),
  }),
  execute: async ({ transactions: items }, context) => {
    const resourceId = resolveResourceId(context);
    const today = new Date().toISOString().slice(0, 10);

    const inserted: Transaction[] = [];
    for (const item of items) {
      inserted.push(
        await addTransaction({
          resourceId,
          merchant: item.merchant,
          amount: item.amount,
          type: item.type,
          category: item.category ?? null,
          date: item.date ?? today,
          seedCategory: null,
        })
      );
    }

    // Drift is evaluated once, after the whole batch is inserted, against the
    // resulting Period totals — so several income rows in one message count
    // together and the offer still fires at most once per Period.
    if (!items.some((item) => item.type === "income")) return { transactions: inserted };

    const threadId = context.agent?.threadId;
    const coachAgent = context.mastra?.getAgent("coach");
    const memory = coachAgent ? await coachAgent.getMemory() : undefined;
    if (!threadId || !memory) return { transactions: inserted };

    const raw = await memory.getWorkingMemory({ threadId, resourceId });
    const current = parseWorkingMemory(raw);
    const declaredIncome = current.declaredIncome as number | undefined;
    const period = new Date().toISOString().slice(0, 7);
    const offeredPeriod = current.incomeDriftOfferedPeriod as string | undefined;

    if (declaredIncome === undefined || offeredPeriod === period) return { transactions: inserted };

    const transactions = await listTransactions(resourceId);
    const analysis = computeAnalysis(transactions, {}, period);
    const drift = Math.abs(analysis.incomeTotal - declaredIncome) / declaredIncome;

    if (drift <= INCOME_DRIFT_THRESHOLD) return { transactions: inserted };

    await memory.updateWorkingMemory({
      threadId,
      resourceId,
      workingMemory: JSON.stringify({ ...current, incomeDriftOfferedPeriod: period }),
    });

    return { transactions: inserted, incomeDrift: { declaredIncome, currentIncomeTotal: analysis.incomeTotal } };
  },
});
