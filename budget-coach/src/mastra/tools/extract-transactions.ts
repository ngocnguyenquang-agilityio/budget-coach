import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { transactionExtractorAgent } from "@/mastra/agents/transaction-extractor";
import { categorizeItems } from "@/mastra/tools/categorize";
import { withToolErrorHandling } from "@/mastra/tools/with-tool-error-handling";

// The extractor's structured-output contract: one { merchant, note?, amount,
// date? } per transaction the user described. date is optional — present only
// when the user said when it happened; note only when they named the item.
const ExtractedItemSchema = z.object({
  merchant: z.string(),
  note: z.string().optional(),
  amount: z.number(),
  date: z.string().optional(),
});
const ExtractAgentOutputSchema = z.object({ items: z.array(ExtractedItemSchema) });

// The tool's output shape matches confirmTransactions' item schema exactly
// (merchant, note, amount, type, suggested category, date) so the Coach can hand the
// result straight to that card with no reshaping — the split and the
// categorization are both already done deterministically.
const ConfirmReadyItemSchema = z.object({
  merchant: z.string(),
  note: z.string().optional(),
  amount: z.number(),
  type: z.enum(["income", "expense"]),
  suggested: CategorySchema.optional(),
  date: z.string().optional(),
});

export const extractTransactionsTool = createTool({
  id: "extract-transactions",
  description:
    "Split a user's natural-language message into the individual transactions it describes (one per amount) and classify each as income or expense with a suggested category. Pass the user's message verbatim as `text`. Returns items ready to hand straight to confirmTransactions. Returns an empty list if the message describes no transaction.",
  inputSchema: z.object({
    text: z
      .string()
      .describe("The user's message describing the money they spent or received, verbatim."),
  }),
  outputSchema: z.object({ items: z.array(ConfirmReadyItemSchema) }),
  execute: withToolErrorHandling(async ({ text }) => {
    // Today's date is resolved server-side (not passed by the Coach) so relative
    // dates like "last Friday" are anchored deterministically.
    const today = new Date().toISOString().slice(0, 10);
    const extraction = await transactionExtractorAgent.generate(
      `Today's date is ${today}.\n\nExtract the transactions from this message:\n${text}`,
      { structuredOutput: { schema: ExtractAgentOutputSchema } },
    );

    const items = extraction.object?.items ?? [];
    if (items.length === 0) return { items: [] };

    // One aligned categorizer pass over the extracted items (same helper the
    // categorizeBatch tool uses), then merge into confirmTransactions' shape.
    const categories = await categorizeItems(
      items.map(({ merchant, amount }) => ({ merchant, amount })),
    );

    return {
      items: items.map((item, index) => {
        const category = categories[index];
        return {
          merchant: item.merchant,
          ...(item.note ? { note: item.note } : {}),
          amount: item.amount,
          type: category.type,
          ...(category.type === "expense" ? { suggested: category.category } : {}),
          ...(item.date ? { date: item.date } : {}),
        };
      }),
    };
  }),
});
