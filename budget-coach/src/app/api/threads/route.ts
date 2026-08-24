import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { listThreadsForResource } from "@/mastra/threads";
import { withErrorHandling } from "@/lib/with-error-handling";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req) => {
  const resourceId = getResourceId(req);
  const threads = await listThreadsForResource(resourceId);

  return NextResponse.json({ threads });
});
