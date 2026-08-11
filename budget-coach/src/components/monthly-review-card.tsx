"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/domain/analysis";
import type { Category, CategoryLimits } from "@/domain/categories";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface MonthlyReviewCardProps {
  proposedLimits: CategoryLimits;
  analysis: AnalysisResult;
  onApprove: () => void;
  onReject: () => void;
}

// Gate 2 (useInterrupt): server-side Mastra suspend/resume. `resolved` guards
// against double-resolve — resolve()/cancel() must only ever fire once per
// interrupt.
export const MonthlyReviewCard = ({
  proposedLimits,
  analysis,
  onApprove,
  onReject,
}: MonthlyReviewCardProps) => {
  const [resolved, setResolved] = useState(false);

  if (resolved) return null;

  const totals = new Map(
    analysis.categoryTotals.map((entry) => [entry.category, entry.total]),
  );
  const categories = Object.keys(proposedLimits) as Category[];

  const handleApprove = () => {
    setResolved(true);
    onApprove();
  };

  const handleReject = () => {
    setResolved(true);
    onReject();
  };

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Monthly Review</CardTitle>
        <CardDescription>
          Proposed category limits based on trailing spend
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {categories.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No changes proposed this month.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {categories.map((category) => (
              <li key={category} className="flex justify-between">
                <span>{category}</span>
                <span>
                  ${(totals.get(category) ?? 0).toFixed(2)} spent → $
                  {(proposedLimits[category] ?? 0).toFixed(2)} limit
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleApprove}>
            Approve
          </Button>
          <Button variant="ghost" className="flex-1" onClick={handleReject}>
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
