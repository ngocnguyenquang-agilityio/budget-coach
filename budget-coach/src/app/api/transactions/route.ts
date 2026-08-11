import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { CategorySchema } from "@/domain/categories";
import {
  addTransaction,
  listTransactions,
  seedIfEmpty,
} from "@/db/transactions";

// Plain (non-agent) route the dashboard reads directly — transactions are
// deliberately not part of agent working memory/shared state.
export const GET = async (req: Request) => {
  const resourceId = getResourceId(req);

  await seedIfEmpty(resourceId);
  const transactions = await listTransactions(resourceId);

  return NextResponse.json({ transactions });
};

// Used by the dashboard's own AddTransactionForm — a plain UI submission,
// not routed back through the agent.
export const POST = async (req: Request) => {
  const resourceId = getResourceId(req);
  const body = await req.json();

  const merchant = String(body.merchant ?? "").trim();
  const amount = Number(body.amount);
  const category = CategorySchema.safeParse(body.category);

  if (!merchant || !Number.isFinite(amount) || !category.success) {
    return NextResponse.json(
      { error: "merchant, amount, and a valid category are required" },
      { status: 400 },
    );
  }

  const transaction = await addTransaction({
    resourceId,
    merchant,
    amount,
    category: category.data,
    date: new Date().toISOString().slice(0, 10),
    seedCategory: null,
  });

  return NextResponse.json({ transaction });
};
