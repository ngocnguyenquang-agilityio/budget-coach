import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { computeRefit } from "@/domain/refit";
import { currentPeriod } from "@/domain/period";
import {
  addSchedule,
  deleteSchedule,
  findScheduleByMerchant,
  listSchedules,
} from "@/db/recurring-schedules";
import { materializeSchedules } from "@/db/transactions";
import { loadBudgetContext } from "@/mastra/lib/budget-context";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { withToolErrorHandling } from "@/mastra/tools/with-tool-error-handling";

const ScheduleSchema = z.object({
  id: z.string(),
  merchant: z.string(),
  amount: z.number(),
  type: z.enum(["income", "expense"]),
  category: CategorySchema.nullable(),
  dayOfMonth: z.number(),
});

// A Recurring Schedule generates one `expected` Transaction per Period
// (ADR-0011). For income that makes Forecast Income real rather than a
// declared figure; for rent and utilities it makes the most predictable
// spending visible before it happens.
export const addRecurringScheduleTool = createTool({
  id: "add-recurring-schedule",
  description:
    "Record a recurring monthly payment the user receives or pays — a salary, rent, a utility bill. It appears each month as an expected transaction they confirm when it actually happens. Category is required for expenses and must be omitted for income.",
  inputSchema: z
    .object({
      merchant: z.string().min(1),
      amount: z.number().positive(),
      type: z.enum(["income", "expense"]),
      category: CategorySchema.optional(),
      dayOfMonth: z.number().int().min(1).max(31).optional(),
    })
    .refine((value) => (value.type === "expense" ? value.category !== undefined : value.category === undefined), {
      message: "category is required for expenses and must be omitted for income",
    }),
  outputSchema: z.object({
    message: z.string(),
    schedule: ScheduleSchema.optional(),
    refitNeeded: z.boolean().optional(),
  }),
  execute: withToolErrorHandling(async ({ merchant, amount, type, category, dayOfMonth }, context) => {
    const resourceId = resolveResourceId(context);

    if (await findScheduleByMerchant(resourceId, merchant)) {
      return { message: `You already have a recurring "${merchant.trim()}" set up.` };
    }

    const schedule = await addSchedule({
      resourceId,
      merchant: merchant.trim(),
      amount,
      type,
      category: category ?? null,
      dayOfMonth: dayOfMonth ?? 1,
    });

    // Generate this Period's row immediately so the change is visible now
    // rather than next month.
    await materializeSchedules(resourceId, currentPeriod());

    // Recurring income raises Forecast Income, which raises the Cap — a
    // Commitment-ledger-adjacent change, so check whether limits still fit.
    const { pots, categoryLimits, period, forecastIncome } = await loadBudgetContext(context);
    const verdict = computeRefit({ forecastIncome, pots, categoryLimits, period });

    return {
      message: `Recorded "${schedule.merchant}" as a recurring ${type} of $${amount.toFixed(2)} on day ${schedule.dayOfMonth}. It'll show up each month as expected until you confirm it.`,
      schedule: {
        id: schedule.id,
        merchant: schedule.merchant,
        amount: schedule.amount,
        type: schedule.type,
        category: schedule.category,
        dayOfMonth: schedule.dayOfMonth,
      },
      refitNeeded: verdict.outcome === "cuts",
    };
  }),
});

export const listRecurringSchedulesTool = createTool({
  id: "list-recurring-schedules",
  description: "List the user's recurring monthly payments (salary, rent, bills).",
  inputSchema: z.object({}),
  outputSchema: z.object({ schedules: z.array(ScheduleSchema) }),
  execute: withToolErrorHandling(async (_input, context) => {
    const resourceId = resolveResourceId(context);
    const schedules = await listSchedules(resourceId);
    return {
      schedules: schedules.map((schedule) => ({
        id: schedule.id,
        merchant: schedule.merchant,
        amount: schedule.amount,
        type: schedule.type,
        category: schedule.category,
        dayOfMonth: schedule.dayOfMonth,
      })),
    };
  }),
});

export const deleteRecurringScheduleTool = createTool({
  id: "delete-recurring-schedule",
  description:
    "Stop a recurring monthly payment, identified by its merchant name. Transactions the user already confirmed are kept; only unconfirmed expected ones are removed.",
  inputSchema: z.object({ merchant: z.string().min(1) }),
  outputSchema: z.object({ message: z.string() }),
  execute: withToolErrorHandling(async ({ merchant }, context) => {
    const resourceId = resolveResourceId(context);
    const schedule = await findScheduleByMerchant(resourceId, merchant);

    if (!schedule) {
      return { message: `You don't have a recurring "${merchant.trim()}" set up.` };
    }

    await deleteSchedule(resourceId, schedule.id);
    return { message: `Stopped the recurring "${schedule.merchant}".` };
  }),
});
