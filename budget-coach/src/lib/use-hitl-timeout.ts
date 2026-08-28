import { useEffect } from "react";

// How long an executing HITL card waits before auto-cancelling so it doesn't block the thread forever.
export const HITL_TIMEOUT_MS = 15 * 60 * 1000;

// Auto-cancels a pending HITL card (useHumanInTheLoop) after HITL_TIMEOUT_MS of inactivity.
export const useHitlTimeout = (
  status: "inProgress" | "executing" | "complete",
  respond: ((response: unknown) => void) | undefined,
  setDecision: (decision: "cancelled") => void,
) => {
  useEffect(() => {
    if (status !== "executing") return;
    const id = setTimeout(() => {
      setDecision("cancelled");
      respond?.({ cancelled: true, reason: "timeout" });
    }, HITL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [status, respond, setDecision]);
};
