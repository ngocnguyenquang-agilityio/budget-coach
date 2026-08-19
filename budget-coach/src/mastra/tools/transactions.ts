import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { addTransaction, listTransactions, seedIfEmpty } from "@/db/transactions";
import { resolveResourceId } from "@/mastra/get-resource-id";

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
  description: "List all transactions for the current user, most recent first.",
  inputSchema: z.object({}),
  outputSchema: z.object({ transactions: z.array(TransactionSchema) }),
  execute: async (_input, context) => {
    const resourceId = resolveResourceId(context);
    await seedIfEmpty(resourceId);
    const transactions = await listTransactions(resourceId);
    return { transactions };
  },
});

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
  outputSchema: TransactionSchema,
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
    return transaction;
  },
});
