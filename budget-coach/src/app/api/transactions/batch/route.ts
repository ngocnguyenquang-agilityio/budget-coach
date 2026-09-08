import { NextResponse } from "next/server";
import { z } from "zod";
import { getResourceId } from "@/mastra/lib/get-resource-id";
import { mastra } from "@/mastra";
import { addTransactionsTool, AddTransactionItemSchema } from "@/mastra/tools/transactions";
import { withErrorHandling } from "@/lib/with-error-handling";

export const runtime = "nodejs";

const BatchBodySchema = z.object({
  transactions: z.array(AddTransactionItemSchema),
  // The active chat thread, so the reused tool can read and write resource
  // working memory to debit a Savings Pot for a pot-funded expense. Optional:
  // without it the tool skips the pot draw (the write still happens).
  threadId: z.string().optional(),
});

// Deterministic write path for the confirm-transactions card. The card records
// the batch here — with the exact categories the user confirmed — instead of
// asking the Coach to emit an addTransactions tool call, which could (and did)
// substitute its own earlier categorizeBatch guess for a user's edit. Reuses
// the Coach's addTransactionsTool verbatim by handing it the same context shape
// its agent caller provides, so batch insert and pot draws stay identical with
// zero logic duplication.
export const POST = withErrorHandling(async (req) => {
  const resourceId = getResourceId(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BatchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "transactions must be a valid array of items", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { transactions, threadId } = parsed.data;

  if (!addTransactionsTool.execute) {
    return NextResponse.json({ error: "add-transactions tool unavailable" }, { status: 500 });
  }

  const result = await addTransactionsTool.execute(
    { transactions },
    { agent: { resourceId, threadId }, mastra } as never,
  );

  return NextResponse.json(result);
});
