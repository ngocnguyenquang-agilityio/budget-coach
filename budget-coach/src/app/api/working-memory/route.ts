import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/lib/get-resource-id";
import { storage } from "@/mastra/config/storage";
import { BudgetStateSchema, type BudgetState } from "@/domain/budget-state";
import { parsePots } from "@/domain/savings-pot";
import { withErrorHandling } from "@/lib/with-error-handling";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req) => {
  const resourceId = getResourceId(req);

  const memoryStore = await storage.getStore("memory");
  const resource = await memoryStore?.getResourceById({ resourceId });
  if (!resource?.workingMemory) {
    return NextResponse.json({ state: {} satisfies BudgetState });
  }

  const raw = JSON.parse(resource.workingMemory) as Record<string, unknown>;

  // Pots are migrated before validation rather than after: a resource written
  // before ADR-0013 holds them in the old `savedSoFar` shape, which fails the
  // discriminated union and would take the *whole* state down with it — the
  // user's limits and balance would vanish from the dashboard along with
  // their pots. parsePots coerces what it can and drops the rest.
  const parsed = BudgetStateSchema.safeParse({ ...raw, savingsPots: parsePots(raw.savingsPots) });
  return NextResponse.json({ state: parsed.success ? parsed.data : {} });
});
