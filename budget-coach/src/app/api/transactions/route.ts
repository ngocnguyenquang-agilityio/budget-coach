import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { CategorySchema, type Category } from "@/domain/categories";
import { addTransaction, listTransactions } from "@/db/transactions";
import { withErrorHandling } from "@/lib/with-error-handling";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req) => {
  const resourceId = getResourceId(req);

  const transactions = await listTransactions(resourceId);

  return NextResponse.json({ transactions });
});

export const POST = withErrorHandling(async (req) => {
  const resourceId = getResourceId(req);
  let body: { merchant?: unknown; amount?: unknown; type?: unknown; category?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const merchant = String(body.merchant ?? "").trim();
  const amount = Number(body.amount);
  const type = body.type === "income" ? "income" : body.type === "expense" ? "expense" : undefined;

  if (!merchant || !Number.isFinite(amount) || !type) {
    return NextResponse.json(
      { error: "merchant, amount, and a valid type are required" },
      { status: 400 },
    );
  }

  let category: Category | null = null;
  if (type === "expense") {
    const parsed = CategorySchema.safeParse(body.category);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "a valid category is required for expenses" },
        { status: 400 },
      );
    }
    category = parsed.data;
  }

  const transaction = await addTransaction({
    resourceId,
    merchant,
    amount,
    type,
    category,
    date: new Date().toISOString().slice(0, 10),
    seedCategory: null,
  });

  return NextResponse.json({ transaction });
});
