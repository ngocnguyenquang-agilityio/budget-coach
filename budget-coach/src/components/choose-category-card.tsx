"use client";

import { useState } from "react";
import type { Category } from "@/domain/categories";
import { parseToolResult } from "@/lib/parse-tool-result";
import { useHitlTimeout } from "@/lib/use-hitl-timeout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface ChooseCategoryCardProps {
  /** Candidate categories the user named; streams in incrementally. */
  categories?: (Category | undefined)[];
  status: "inProgress" | "executing" | "complete";
  respond?: (response: unknown) => void;
  /** Set once the call has completed — including on a replayed transcript. */
  result?: string;
  /** Applies the choice to the dashboard filter, deterministically. */
  onSelect: (category: Category) => void;
}

// What the card sent back through `respond`, restored on a re-opened
// transcript where local state no longer exists (mirrors SavingsGoalCard).
const restoreDecision = (
  result: string | undefined,
): { decision: "selected" | "cancelled"; category?: string } | null => {
  if (!result) return null;

  const parsed = parseToolResult<unknown>(result, result);
  const text = typeof parsed === "string" ? parsed : "";

  if (text.startsWith("User cancelled")) return { decision: "cancelled" };
  const category = text.match(/User chose (.+?)\./)?.[1];
  if (!category) return null;
  return { decision: "selected", category };
};

// Pure frontend HITL, no server suspend: the user picks one category from the
// several they named, the card applies the dashboard filter itself via
// onSelect (deterministic, like ConfirmTransactionsCard), then tells the model
// what happened. Cancel means nothing was filtered, so there's nothing to
// discard.
export const ChooseCategoryCard = ({
  categories,
  status,
  respond,
  result,
  onSelect,
}: ChooseCategoryCardProps) => {
  const [localDecision, setLocalDecision] = useState<
    "selected" | "cancelled" | null
  >(null);

  useHitlTimeout(status, respond, setLocalDecision);

  const restored = restoreDecision(result);
  const decision = localDecision ?? restored?.decision ?? null;

  if (decision === "selected") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Filtered the Transactions list
          {restored?.category ? ` to ${restored.category}` : ""}.
        </CardContent>
      </Card>
    );
  }

  if (decision === "cancelled") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          No category was selected.
        </CardContent>
      </Card>
    );
  }

  // Drop any still-undefined slots from the streamed array.
  const options = (categories ?? []).filter(
    (category): category is Category => Boolean(category),
  );

  const handleSelect = (category: Category) => {
    setLocalDecision("selected");
    onSelect(category);
    respond?.(
      `User chose ${category}. The Transactions list is now filtered to it — just acknowledge.`,
    );
  };

  const handleCancel = () => {
    setLocalDecision("cancelled");
    respond?.("User cancelled — no category was selected.");
  };

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader className="p-4 pb-3">
        <CardTitle className="text-base">Which category?</CardTitle>
        <CardDescription>
          Only one can be shown at a time — pick which to filter to.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {status === "executing" && (
          <div className="flex flex-wrap items-center gap-2">
            {options.map((category) => (
              <Button
                key={category}
                variant="outline"
                onClick={() => handleSelect(category)}
              >
                {category}
              </Button>
            ))}
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
