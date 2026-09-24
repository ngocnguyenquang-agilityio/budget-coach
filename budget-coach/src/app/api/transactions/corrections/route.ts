import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/lib/get-resource-id";
import { storage } from "@/mastra/config/storage";
import { CorrectionRequestSchema } from "@/domain/transaction-correction";
import { applyTransactionCorrections } from "@/mastra/lib/apply-transaction-corrections";
import { withErrorHandling } from "@/lib/with-error-handling";

export const runtime = "nodejs";

// Write path for the edit/delete confirmation cards (ADR-0016). The card calls
// this with exactly the rows the User ticked; the Coach has no tool that
// reaches it. resourceId comes only from the middleware header, never the body.
// Working memory is read and written by resourceId alone (scope: "resource",
// same as /api/working-memory), so no chat thread is needed.
export const POST = withErrorHandling(async (req) => {
  const resourceId = getResourceId(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CorrectionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid correction request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const memoryStore = await storage.getStore("memory");
  if (!memoryStore) {
    return NextResponse.json({ error: "Memory storage unavailable" }, { status: 500 });
  }

  const result = await applyTransactionCorrections(parsed.data, {
    resourceId,
    workingMemory: {
      get: async () => (await memoryStore.getResourceById({ resourceId }))?.workingMemory ?? null,
      set: (workingMemory) => memoryStore.updateResource({ resourceId, workingMemory }),
    },
  });

  return NextResponse.json(result);
});
