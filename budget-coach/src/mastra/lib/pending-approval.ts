import { PENDING_APPROVAL_TTL_MS } from "@/constants/pending-approval";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";

export type PendingApproval = {
  runId?: string;
  workflow?: string | null;
  createdAt?: string;
};

// True once a pending approval is old enough to treat as abandoned rather
// than genuinely awaiting a decision. Missing `createdAt` means it was
// written before this field existed — there's no way to know its real age,
// and nothing is lost by letting the next attempt reclaim it, so treat it
// as stale too.
export const isPendingApprovalStale = (pending: PendingApproval | undefined): boolean => {
  if (!pending?.runId) return false;
  if (!pending.createdAt) return true;
  const createdAt = Date.parse(pending.createdAt);
  if (Number.isNaN(createdAt)) return true;
  return Date.now() - createdAt > PENDING_APPROVAL_TTL_MS;
};

type WorkingMemoryStore = {
  getWorkingMemory(args: { threadId: string; resourceId: string }): Promise<string | null>;
  updateWorkingMemory(args: { threadId: string; resourceId: string; workingMemory: string }): Promise<unknown>;
};

// Clears a pending approval whose resumed run failed. applyOrDiscard — the
// only step that normally clears it — never finished, so without this the
// user is told "an approval is awaiting your decision" for a card they have
// already answered, until the TTL above expires. Re-reads working memory so
// the write never clobbers anything saved since the tool's own read.
export const clearPendingApproval = async (
  memory: WorkingMemoryStore,
  threadId: string,
  resourceId: string,
): Promise<void> => {
  const current = parseWorkingMemory(await memory.getWorkingMemory({ threadId, resourceId }));
  await memory.updateWorkingMemory({
    threadId,
    resourceId,
    workingMemory: JSON.stringify({ ...current, pendingApproval: null }),
  });
};
