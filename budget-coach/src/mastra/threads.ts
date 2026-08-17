import { mastra } from "@/mastra";
import { THREAD_LIST_PAGE_SIZE } from "@/constants/threads";

// Thread listing/renaming/deletion over Mastra's own memory tables, which is
// what makes the conversation list durable: unlike CopilotKit's local thread
// endpoints (backed by a per-instance in-memory Map, and whose mutations require
// Intelligence anyway), these survive cold starts and redeploys.

export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type OwnedThread = {
  id: string;
  title?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

// "coach" is the Mastra registration key — the id everything in this app uses to
// refer to an agent. The Coach is also the only agent carrying Memory.
export const getCoachMemory = async () => {
  const memory = await mastra.getAgent("coach").getMemory();

  if (!memory) {
    throw new Error("Coach agent has no memory configured");
  }

  return memory;
};

// A thread id is a guessable UUID and every route below takes one from the URL,
// so ownership is checked against the caller's resourceId on every access rather
// than trusted from the client.
export const isOwnedBy = (
  thread: { resourceId?: string | null } | null | undefined,
  resourceId: string,
): boolean => Boolean(thread && thread.resourceId === resourceId);

const toIso = (value: Date | string | undefined): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
};

const toSummary = (thread: OwnedThread): ThreadSummary => ({
  id: thread.id,
  title: thread.title ?? "",
  createdAt: toIso(thread.createdAt),
  updatedAt: toIso(thread.updatedAt),
});

export const listThreadsForResource = async (
  resourceId: string,
): Promise<ThreadSummary[]> => {
  const memory = await getCoachMemory();
  const { threads } = await memory.listThreads({
    filter: { resourceId },
    orderBy: { field: "updatedAt", direction: "DESC" },
    perPage: THREAD_LIST_PAGE_SIZE,
    page: 0,
  });

  return threads.map(toSummary);
};

export const getOwnedThread = async (
  threadId: string,
  resourceId: string,
): Promise<ThreadSummary | null> => {
  const memory = await getCoachMemory();
  const thread = await memory.getThreadById({ threadId });

  return isOwnedBy(thread, resourceId) ? toSummary(thread as OwnedThread) : null;
};

export const renameThread = async (
  threadId: string,
  resourceId: string,
  title: string,
): Promise<ThreadSummary | null> => {
  const memory = await getCoachMemory();
  const thread = await memory.getThreadById({ threadId });
  if (!isOwnedBy(thread, resourceId)) return null;

  // `metadata` is required by the signature — passing the existing value back
  // keeps a rename from wiping whatever else is stored on the thread.
  const updated = await memory.updateThread({
    id: threadId,
    title,
    metadata: (thread as OwnedThread).metadata ?? {},
  });

  return toSummary(updated as OwnedThread);
};

export const removeThread = async (
  threadId: string,
  resourceId: string,
): Promise<boolean> => {
  const memory = await getCoachMemory();
  const thread = await memory.getThreadById({ threadId });
  if (!isOwnedBy(thread, resourceId)) return false;

  // LibSQL deletes the thread's messages alongside the thread row.
  await memory.deleteThread(threadId);
  return true;
};
