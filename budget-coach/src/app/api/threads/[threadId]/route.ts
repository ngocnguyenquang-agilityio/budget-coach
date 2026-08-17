import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { removeThread, renameThread } from "@/mastra/threads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ threadId: string }> };

export const PATCH = async (req: Request, { params }: RouteContext) => {
  const resourceId = getResourceId(req);
  const { threadId } = await params;
  const body = await req.json();

  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const thread = await renameThread(threadId, resourceId, title);
  // A thread belonging to another browser is reported as missing rather than
  // forbidden, so the response can't be used to probe which ids exist.
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ thread });
};

export const DELETE = async (req: Request, { params }: RouteContext) => {
  const resourceId = getResourceId(req);
  const { threadId } = await params;

  const deleted = await removeThread(threadId, resourceId);
  if (!deleted) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
};
