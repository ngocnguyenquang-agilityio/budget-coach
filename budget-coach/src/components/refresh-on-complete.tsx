"use client";

import { useEffect, useRef } from "react";

// Some tools change what the Transactions list should show (confirming an
// expected transaction, adding a recurring schedule) without rendering a card
// of their own. This fires the refresh once, on the transition into
// "complete" — in an effect, never in the render body, since the callback
// sets state and would otherwise re-fire on every re-render.
export const RefreshOnComplete = ({
  status,
  onComplete,
}: {
  status: "inProgress" | "executing" | "complete";
  onComplete: () => void;
}) => {
  const fired = useRef(false);

  useEffect(() => {
    if (status !== "complete" || fired.current) return;
    fired.current = true;
    onComplete();
  }, [status, onComplete]);

  return null;
};
