"use client";

import { useState } from "react";
import { CATEGORIES, type Category } from "@/domain/categories";
import { parseToolResult } from "@/lib/parse-tool-result";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface ConfirmTransactionCardProps {
  merchant?: string;
  amount?: number;
  type?: "income" | "expense";
  suggested?: Category;
  date?: string;
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
): { decision: "confirmed" | "cancelled"; type?: "income" | "expense"; category?: Category } | null => {
  if (!result) return null;

  // The value arrives JSON-encoded; a raw string is the defensive fallback.
  const parsed = parseToolResult<unknown>(result, result);
  const text = typeof parsed === "string" ? parsed : "";

  // Matches the instructions handleConfirm/handleCancel send below.
  if (text.startsWith("User cancelled")) return { decision: "cancelled" };
  if (!text.startsWith("User confirmed")) return null;

  const type = text.match(/type="(income|expense)"/)?.[1] as "income" | "expense" | undefined;
  const category = text.match(/category="([^"]+)"/)?.[1];
  return {
    decision: "confirmed",
    ...(type ? { type } : {}),
    ...(category ? { category: category as Category } : {}),
  };
};

// Gate 1 (useHumanInTheLoop): purely client-side confirmation, no server
// suspend. `respond` feeds the model a natural-language instruction rather
// than a bare category string — local llama3.1 reliably follows an explicit
// "call addTransaction with ..." instruction but not a bare confirmation.
// Shows a category picker only when the transaction is an expense — income
// transactions carry no category.
export const ConfirmTransactionCard = ({
  merchant,
  amount,
  type,
  suggested,
  date,
  status,
  respond,
  result,
}: ConfirmTransactionCardProps) => {
  const [chosenType, setChosenType] = useState<"income" | "expense">(type ?? "expense");
  const [chosenCategory, setChosenCategory] = useState<Category | undefined>(suggested);
  const [localDecision, setLocalDecision] = useState<
    "confirmed" | "cancelled" | null
  >(null);

  const restored = restoreDecision(result);
  const decision = localDecision ?? restored?.decision ?? null;
  const confirmedType = restored?.type ?? chosenType;
  const confirmedCategory = restored?.category ?? chosenCategory;

  if (decision === "confirmed") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Confirmed {merchant ?? "this transaction"} as{" "}
          {confirmedType === "income" ? "Income" : confirmedCategory}.
        </CardContent>
      </Card>
    );
  }

  if (decision === "cancelled") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Transaction confirmation cancelled.
        </CardContent>
      </Card>
    );
  }

  const handleConfirm = () => {
    if (chosenType === "expense" && !chosenCategory) return;
    setLocalDecision("confirmed");
    const base =
      `User confirmed ${merchant ?? "this transaction"}` +
      `${amount !== undefined ? ` ($${amount.toFixed(2)})` : ""} as ` +
      `${chosenType === "income" ? "income" : `expense, category "${chosenCategory}"`}. `;
    const dateClause = date ? `, date="${date}"` : "";
    const instruction =
      chosenType === "income"
        ? `Call addTransaction with merchant="${merchant ?? ""}", amount=${amount ?? 0}, type="income"${dateClause}.`
        : `Call addTransaction with merchant="${merchant ?? ""}", amount=${amount ?? 0}, type="expense", category="${chosenCategory}"${dateClause}.`;
    respond?.(base + instruction);
  };

  const handleCancel = () => {
    setLocalDecision("cancelled");
    respond?.("User cancelled — do not record this transaction.");
  };

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Confirm transaction</CardTitle>
        <CardDescription>
          {merchant ?? "This transaction"}
          {amount !== undefined ? ` — $${amount.toFixed(2)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={chosenType === "expense" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => setChosenType("expense")}
          >
            Expense
          </Button>
          <Button
            type="button"
            variant={chosenType === "income" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => setChosenType("income")}
          >
            Income
          </Button>
        </div>
        {chosenType === "expense" && (
          <select
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            value={chosenCategory ?? ""}
            onChange={(event) => setChosenCategory(event.target.value as Category)}
          >
            <option value="" disabled>
              Choose a category
            </option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        )}
        {status === "executing" && (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={chosenType === "expense" && !chosenCategory}
              onClick={handleConfirm}
            >
              Confirm
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
