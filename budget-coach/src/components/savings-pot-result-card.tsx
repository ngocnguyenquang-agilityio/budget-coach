"use client";

import type { SavingsPot } from "@/domain/savings-pot";
import { parseToolResult } from "@/lib/parse-tool-result";
import { SavingsPotProgress } from "@/components/savings-pot-progress";
import { Card, CardContent } from "@/components/ui/card";

interface PotToolResult {
  pot?: SavingsPot;
  message?: string;
  success?: false;
  error?: string;
}

// Chat render card for createSavingsPot / contributeToPot / updateSavingsPot —
// gives each pot action a visible result (the fix for the original
// "agent responds but nothing renders" bug). On a soft failure (duplicate /
// not found) there's no `pot`, so nothing renders here and the Coach relays
// the `message` in text instead.
export const SavingsPotResultCard = ({
  status,
  result,
}: {
  status: "inProgress" | "executing" | "complete";
  result?: string;
}) => {
  if (status !== "complete") {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">Updating savings pot…</p>
    );
  }

  const parsed = parseToolResult<PotToolResult>(result, {});

  if (parsed.success === false) {
    return (
      <p className="text-sm text-[var(--destructive)]">
        {parsed.error ?? "Couldn't update the savings pot — try again."}
      </p>
    );
  }

  if (!parsed.pot) return null;

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardContent className="pt-6">
        <SavingsPotProgress pot={parsed.pot} />
      </CardContent>
    </Card>
  );
};
