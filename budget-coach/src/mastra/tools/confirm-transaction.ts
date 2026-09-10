import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { currentPeriod } from "@/domain/period";
import { computeRefit } from "@/domain/refit";
import { confirmTransaction, listTransactions } from "@/db/transactions";
import { loadBudgetContext } from "@/mastra/lib/budget-context";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { withToolErrorHandling } from "@/mastra/tools/with-tool-error-handling";

const ExpectedSchema = z.object({
  id: z.string(),
  merchant: z.string(),
  amount: z.number(),
  type: z.enum(["income", "expense"]),
  date: z.string(),
});

// Transfers are always created with status "received" (savings-pots.ts), so
// an "expected" transaction can never actually be a transfer in practice —
// but this narrows (and guards, if that invariant is ever broken) the DB's
// wider type back to what this tool's schema promises.
const isConfirmableTransaction = <T extends { type: "income" | "expense" | "transfer" }>(
  transaction: T
): transaction is T & { type: "income" | "expense" } => transaction.type !== "transfer";

export const listExpectedTransactionsTool = createTool({
  id: "list-expected-transactions",
  description:
    "List this month's expected (unconfirmed) transactions — money the user's recurring schedules say should arrive or go out but that hasn't been confirmed yet.",
  inputSchema: z.object({}),
  outputSchema: z.object({ expected: z.array(ExpectedSchema) }),
  execute: withToolErrorHandling(async (_input, context) => {
    const resourceId = resolveResourceId(context);
    const period = currentPeriod();
    const transactions = await listTransactions(resourceId);

    return {
      expected: transactions
        .filter((transaction) => transaction.status === "expected" && transaction.date.startsWith(period))
        .filter(isConfirmableTransaction)
        .map(({ id, merchant, amount, type, date }) => ({ id, merchant, amount, type, date })),
    };
  }),
});

// Confirming is also the moment a user corrects the amount — "my paycheck was
// actually $2,900" — which is why `amount` is optional here rather than
// requiring a separate edit (ADR-0011).
export const confirmTransactionTool = createTool({
  id: "confirm-transaction",
  description:
    "Confirm that an expected transaction actually happened, optionally correcting its amount. Identify it by merchant name. Only a confirmed transaction counts toward income, spending limits, and savings.",
  inputSchema: z.object({
    merchant: z.string().min(1),
    amount: z.number().positive().optional().describe("Only if the real amount differed from what was expected"),
  }),
  outputSchema: z.object({
    message: z.string(),
    confirmed: ExpectedSchema.optional(),
    refitNeeded: z.boolean().optional(),
  }),
  execute: withToolErrorHandling(async ({ merchant, amount }, context) => {
    const resourceId = resolveResourceId(context);
    const period = currentPeriod();
    const transactions = await listTransactions(resourceId);

    const match = transactions.find(
      (transaction) =>
        transaction.status === "expected" &&
        transaction.date.startsWith(period) &&
        transaction.merchant.toLowerCase() === merchant.trim().toLowerCase()
    );

    if (!match) {
      return { message: `There's no expected "${merchant.trim()}" waiting to be confirmed this month.` };
    }

    const confirmed = await confirmTransaction(resourceId, match.id, amount);
    if (!confirmed) {
      return { message: `Couldn't find that transaction to confirm.` };
    }
    if (!isConfirmableTransaction(confirmed)) {
      return { message: `Couldn't find that transaction to confirm.` };
    }

    const changed = amount !== undefined && amount !== match.amount;

    // Correcting an income amount moves Forecast Income, which moves the Cap
    // — ADR-0014 lists "income revised" as a refit trigger, so limits can't
    // be left silently above the new Cap.
    let refitNeeded = false;
    if (changed && confirmed.type === "income") {
      const { pots, categoryLimits, period, forecastIncome } = await loadBudgetContext(context);
      refitNeeded = computeRefit({ forecastIncome, pots, categoryLimits, period }).outcome === "cuts";
    }

    return {
      message: changed
        ? `Confirmed "${confirmed.merchant}" at $${confirmed.amount.toFixed(2)} (expected $${match.amount.toFixed(2)}).`
        : `Confirmed "${confirmed.merchant}" at $${confirmed.amount.toFixed(2)}.`,
      confirmed: {
        id: confirmed.id,
        merchant: confirmed.merchant,
        amount: confirmed.amount,
        type: confirmed.type,
        date: confirmed.date,
      },
      refitNeeded,
    };
  }),
});
