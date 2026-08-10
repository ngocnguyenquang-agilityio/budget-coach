import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { listTransactions, seedIfEmpty } from "@/db/transactions";

// Plain (non-agent) route the dashboard reads directly — transactions are
// deliberately not part of agent working memory/shared state.
export async function GET(req: Request) {
  const resourceId = getResourceId(req);

  await seedIfEmpty(resourceId);
  const transactions = await listTransactions(resourceId);

  return NextResponse.json({ transactions });
}
