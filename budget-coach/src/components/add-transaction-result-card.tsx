"use client";

import { useEffect } from "react";

export interface AddTransactionResultCardProps {
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
  onComplete: () => void;
}

// `result` arrives as a JSON string once the tool call completes — parsed
// defensively since a weak local model's tool output isn't guaranteed
// well-formed. `onComplete` refreshes the dashboard's own transaction list,
// which is fetched separately over REST rather than living in shared state.
export const AddTransactionResultCard = ({
  status,
  result,
  onComplete,
}: AddTransactionResultCardProps) => {
  useEffect(() => {
    if (status === "complete") onComplete();
  }, [status, onComplete]);

  if (status !== "complete") {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Recording transaction…
      </p>
    );
  }

  let parsed: { merchant?: string; amount?: number; category?: string } = {};
  try {
    parsed = result ? JSON.parse(result) : {};
  } catch {
    // fall through with an empty summary
  }

  return (
    <p className="text-sm">
      Added {parsed.merchant ?? "transaction"}
      {parsed.amount !== undefined ? ` — $${parsed.amount.toFixed(2)}` : ""}
      {parsed.category ? ` (${parsed.category})` : ""}
    </p>
  );
};
