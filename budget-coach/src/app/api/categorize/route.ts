import { NextResponse } from "next/server";
import { categorizeItems } from "@/mastra/tools/categorize";
import { withErrorHandling } from "@/lib/with-error-handling";

export const runtime = "nodejs";

// Single-item categorization for the add-transaction form's open path, so the
// prefilled category comes from the same categorizer (categorizeItems) the
// confirmTransactions flow uses — not the Coach's own inference. Auth is
// already enforced by the Clerk middleware; classification needs no resourceId.
export const POST = withErrorHandling(async (req) => {
  let body: { merchant?: unknown; amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const merchant = String(body.merchant ?? "").trim();
  const amount = Number(body.amount);

  if (!merchant || !Number.isFinite(amount)) {
    return NextResponse.json(
      { error: "merchant and a numeric amount are required" },
      { status: 400 },
    );
  }

  const [result] = await categorizeItems([{ merchant, amount }]);

  return NextResponse.json({ type: result.type, category: result.category ?? null });
});
