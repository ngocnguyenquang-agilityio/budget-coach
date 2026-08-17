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

export interface CategoryConfirmCardProps {
  merchant?: string;
  amount?: number;
  suggested?: Category;
  status: "inProgress" | "executing" | "complete";
  respond?: (response: unknown) => void;
  /** Set once the call has completed — including on a replayed transcript. */
  result?: string;
}

// What the card sent back through `respond`, as it comes back on a restored
// transcript. Local `decision` state covers the live path; this covers a
// conversation re-opened later, where that state no longer exists and the card
// would otherwise render as an inert dropdown with no buttons.
const restoreDecision = (
  result: string | undefined,
): { decision: "confirmed" | "cancelled"; category?: Category } | null => {
  if (!result) return null;

  // The value arrives JSON-encoded; a raw string is the defensive fallback.
  const parsed = parseToolResult<unknown>(result, result);
  const text = typeof parsed === "string" ? parsed : "";

  // Matches the instructions handleConfirm/handleCancel send below.
  if (text.startsWith("User cancelled")) return { decision: "cancelled" };
  if (!text.startsWith("User confirmed")) return null;

  const category = text.match(/category "([^"]+)"/)?.[1];
  return {
    decision: "confirmed",
    ...(category ? { category: category as Category } : {}),
  };
};

// Gate 1 (useHumanInTheLoop): purely client-side confirmation, no server
// suspend. `respond` feeds the model a natural-language instruction rather
// than a bare category string — local llama3.1 reliably follows an explicit
// "call addTransaction with ..." instruction but not a bare confirmation.
export const CategoryConfirmCard = ({
  merchant,
  amount,
  suggested,
  status,
  respond,
  result,
}: CategoryConfirmCardProps) => {
  const [chosen, setChosen] = useState<Category | undefined>(suggested);
  const [localDecision, setLocalDecision] = useState<
    "confirmed" | "cancelled" | null
  >(null);

  const restored = restoreDecision(result);
  const decision = localDecision ?? restored?.decision ?? null;
  const confirmedCategory = chosen ?? restored?.category;

  if (decision === "confirmed" && confirmedCategory) {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Confirmed {merchant ?? "this transaction"} as {confirmedCategory}.
        </CardContent>
      </Card>
    );
  }

  if (decision === "cancelled") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Category confirmation cancelled.
        </CardContent>
      </Card>
    );
  }

  const handleConfirm = () => {
    if (!chosen) return;
    setLocalDecision("confirmed");
    respond?.(
      `User confirmed the category "${chosen}" for ${merchant ?? "this transaction"}` +
        `${amount !== undefined ? ` ($${amount.toFixed(2)})` : ""}. ` +
        `Call addTransaction with merchant="${merchant ?? ""}", amount=${amount ?? 0}, category="${chosen}".`,
    );
  };

  const handleCancel = () => {
    setLocalDecision("cancelled");
    respond?.("User cancelled — do not record this transaction.");
  };

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Confirm category</CardTitle>
        <CardDescription>
          {merchant ?? "This transaction"}
          {amount !== undefined ? ` — $${amount.toFixed(2)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <select
          className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          value={chosen ?? ""}
          onChange={(event) => setChosen(event.target.value as Category)}
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
        {status === "executing" && (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!chosen}
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
