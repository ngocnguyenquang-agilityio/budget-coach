"use client";

import { useState } from "react";
import { parseToolResult } from "@/lib/parse-tool-result";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface DeclaredIncomeCardProps {
  status: "inProgress" | "executing" | "complete";
  respond?: (response: unknown) => void;
  /** Set once the call has completed — including on a replayed transcript. */
  result?: string;
}

// What the card sent back through `respond`, as it comes back on a restored
// transcript. Local state covers the live path; this covers a conversation
// re-opened later, where that state no longer exists and the card would
// otherwise render as an inert form with no buttons.
const restoreDecision = (
  result: string | undefined,
): { decision: "submitted" | "cancelled"; declaredIncome?: number } | null => {
  if (!result) return null;

  // The value arrives JSON-encoded; a raw string is the defensive fallback.
  const parsed = parseToolResult<unknown>(result, result);
  const text = typeof parsed === "string" ? parsed : "";

  // Matches the instructions handleSubmit/handleCancel send below.
  if (text.startsWith("User cancelled")) return { decision: "cancelled" };
  if (!text.startsWith("User declared income of")) return null;

  const declaredIncome = text.match(/User declared income of \$([\d.]+)/)?.[1];
  return {
    decision: "submitted",
    ...(declaredIncome ? { declaredIncome: Number(declaredIncome) } : {}),
  };
};

// The Monthly Review's pre-workflow income box (useHumanInTheLoop): purely
// client-side, no server suspend — Cancel means the workflow never starts,
// so there's nothing to discard. `respond` feeds the model an explicit
// instruction rather than a bare number, matching ConfirmTransactionCard's
// pattern (local llama3.1 reliably follows an explicit "call X with ..."
// instruction but not a bare value).
export const DeclaredIncomeCard = ({ status, respond, result }: DeclaredIncomeCardProps) => {
  const [value, setValue] = useState("");
  const [localDecision, setLocalDecision] = useState<"submitted" | "cancelled" | null>(null);

  const restored = restoreDecision(result);
  const decision = localDecision ?? restored?.decision ?? null;
  const declaredIncome = restored?.declaredIncome;

  if (decision === "submitted") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Declared income{declaredIncome !== undefined ? ` of $${declaredIncome.toFixed(2)}` : ""} recorded.
        </CardContent>
      </Card>
    );
  }

  if (decision === "cancelled") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Monthly Review cancelled.
        </CardContent>
      </Card>
    );
  }

  const numericValue = Number(value);
  const isValid = value.trim() !== "" && Number.isFinite(numericValue) && numericValue > 0;

  const handleSubmit = () => {
    if (!isValid) return;
    setLocalDecision("submitted");
    respond?.(
      `User declared income of $${numericValue}. Call setDeclaredIncome with declaredIncome=${numericValue} then call approveBudget.`,
    );
  };

  const handleCancel = () => {
    setLocalDecision("cancelled");
    respond?.("User cancelled — do not run the Monthly Review.");
  };

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">What&apos;s your income this month?</CardTitle>
        <CardDescription>Used to cap this Monthly Review&apos;s category limits.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="number"
          min="0"
          step="0.01"
          className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          placeholder="Monthly income"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {status === "executing" && (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!isValid} onClick={handleSubmit}>
              Submit
            </Button>
            <Button variant="ghost" className="flex-1" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
