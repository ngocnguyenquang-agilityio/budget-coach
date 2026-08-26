"use client";

import { useEffect } from "react";
import { parseToolResult } from "@/lib/parse-tool-result";

export interface DeclaredIncomeResultCardProps {
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
  onComplete: () => void;
}

// Rendered for the setDeclaredIncome tool call. Its only job beyond a short
// confirmation is to refresh the dashboard's transactions once the tool
// completes — setDeclaredIncome now records an Income transaction, and nothing
// else on this flow triggers a transaction re-fetch.
export const DeclaredIncomeResultCard = ({
  status,
  result,
  onComplete,
}: DeclaredIncomeResultCardProps) => {
  useEffect(() => {
    if (status === "complete") onComplete();
  }, [status, onComplete]);

  if (status !== "complete") {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Recording declared income…
      </p>
    );
  }

  const { declaredIncome } = parseToolResult<{ declaredIncome?: number }>(result, {});

  return (
    <p className="text-sm">
      Declared income
      {declaredIncome !== undefined ? ` of $${declaredIncome.toFixed(2)}` : ""} recorded.
    </p>
  );
};
