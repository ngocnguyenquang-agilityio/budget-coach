import { PENDING_APPROVAL_TTL_MS } from "@/constants/pending-approval";

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
