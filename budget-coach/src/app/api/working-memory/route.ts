import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { storage } from "@/mastra/storage";
import { BudgetStateSchema, type BudgetState } from "@/domain/budget-state";

export const runtime = "nodejs";

export const GET = async (req: Request) => {
  const resourceId = getResourceId(req);

  const memoryStore = await storage.getStore("memory");
  const resource = await memoryStore?.getResourceById({ resourceId });
  if (!resource?.workingMemory) {
    return NextResponse.json({ state: {} satisfies BudgetState });
  }

  const parsed = BudgetStateSchema.safeParse(JSON.parse(resource.workingMemory));
  return NextResponse.json({ state: parsed.success ? parsed.data : {} });
};
