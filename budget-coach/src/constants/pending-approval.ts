// Recovery path for abandoned approvals: applyOrDiscard is the only place
// pendingApproval clears, and it only runs on resume — so a closed tab or
// dead thread leaves it stuck forever without this TTL.
export const PENDING_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
