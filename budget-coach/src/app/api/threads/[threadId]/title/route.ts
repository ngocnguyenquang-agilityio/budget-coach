import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { generateThreadTitle } from "@/mastra/thread-naming";

export const runtime = "nodejs";

// Called by the drawer after a run finishes on an untitled thread. It is a
// request of its own — not work tacked onto the chat request — so the LLM call
// finishes inside a function invocation that is still alive.
export const POST = async (
  req: Request,
  { params }: { params: Promise<{ threadId: string }> },
) => {
  const resourceId = getResourceId(req);
  const { threadId } = await params;

  const title = await generateThreadTitle({ threadId, resourceId });
  if (title === null) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ title });
};
