"use client";

import { useState } from "react";
import { CATEGORIES, type Category } from "@/domain/categories";
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
}

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
}: CategoryConfirmCardProps) => {
  const [chosen, setChosen] = useState<Category | undefined>(suggested);
  const [decision, setDecision] = useState<"confirmed" | "cancelled" | null>(
    null,
  );

  if (decision === "confirmed" && chosen) {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Confirmed {merchant ?? "this transaction"} as {chosen}.
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
    setDecision("confirmed");
    respond?.(
      `User confirmed the category "${chosen}" for ${merchant ?? "this transaction"}` +
        `${amount !== undefined ? ` ($${amount.toFixed(2)})` : ""}. ` +
        `Call addTransaction with merchant="${merchant ?? ""}", amount=${amount ?? 0}, category="${chosen}".`,
    );
  };

  const handleCancel = () => {
    setDecision("cancelled");
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
