"use client";

import type { AnalysisResult } from "@/domain/analysis";
import type { Category, CategoryLimits } from "@/domain/categories";
import { CATEGORY_COLORS } from "@/constants/chart-colors";

export const BudgetProgressBars = ({
  analysis,
  categoryLimits,
  highlightedCategory,
}: {
  analysis: AnalysisResult;
  categoryLimits: CategoryLimits;
  highlightedCategory?: Category;
}) => {
  const rows = analysis.categoryTotals.filter((entry) => entry.total > 0);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No spending to show yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map(({ category, total, overLimit }) => {
        const limit = categoryLimits[category];
        const pct = limit
          ? Math.min(100, Math.round((total / limit) * 100))
          : 0;
        const highlighted = highlightedCategory === category;

        return (
          <div
            key={category}
            className={`rounded-[var(--radius)] p-1.5 ${
              highlighted
                ? "ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--card)]"
                : ""
            }`}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="flex items-center gap-1.5 font-medium">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[category] }}
                />
                {category}
              </span>
              <span
                className={
                  overLimit
                    ? "text-[var(--destructive)] font-semibold"
                    : "text-[var(--muted-foreground)]"
                }
              >
                ${total.toFixed(2)}
                {limit !== undefined
                  ? ` / $${limit.toFixed(2)}`
                  : " (no limit set)"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: limit ? `${pct}%` : "0%",
                  backgroundColor: overLimit
                    ? "var(--destructive)"
                    : CATEGORY_COLORS[category],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
