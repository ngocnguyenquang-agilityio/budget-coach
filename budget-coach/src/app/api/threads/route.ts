import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { listThreadsForResource } from "@/mastra/threads";

export const runtime = "nodejs";

export const GET = async (req: Request) => {
  const resourceId = getResourceId(req);
  const threads = await listThreadsForResource(resourceId);

  return NextResponse.json({ threads });
};
