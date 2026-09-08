"use client";

import type { AnalysisResult } from "@/domain/analysis";
import { CATEGORIES, type Category, type CategoryLimits } from "@/domain/categories";
import { CATEGORY_COLORS } from "@/constants/chart-colors";

export const BudgetProgressBars = ({
  analysis,
  categoryLimits,
  selectedCategory,
  onSelectCategory,
}: {
  analysis: AnalysisResult;
  categoryLimits: CategoryLimits;
  selectedCategory?: Category;
  onSelectCategory?: (category: Category) => void;
}) => {
  // A category with a limit set but no transactions this period has nothing
  // in analysis.categoryTotals (computeAnalysis only emits entries for
  // categories that appear in the transaction list) — shown here anyway,
  // at $0 spent, so a limit set with no spending isn't hidden.
  const totalsByCategory = new Map(analysis.categoryTotals.map((entry) => [entry.category, entry]));
  const rows = CATEGORIES.filter(
    (category) =>
      (totalsByCategory.get(category)?.committed ?? 0) > 0 || categoryLimits[category] !== undefined,
  ).map(
    (category) =>
      totalsByCategory.get(category) ?? {
        category,
        spent: 0,
        committed: 0,
        // computeAnalysis's own formulas with spent/committed substituted as
        // 0, for the entries synthesized here.
        overLimit: false,
        onTrackToExceed: false,
      },
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No spending to show yet.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map(({ category, spent, committed, overLimit, onTrackToExceed }) => {
        const limit = categoryLimits[category];
        const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
        // The still-expected portion, drawn as a lighter segment past the
        // spent bar so "already gone" and "still due" read differently
        // (ADR-0011: overspending and being about to are different messages).
        const pendingPct = limit
          ? Math.min(100 - pct, Math.round(((committed - spent) / limit) * 100))
          : 0;
        const selected = selectedCategory === category;

        return (
          <div
            key={category}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={() => onSelectCategory?.(category)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectCategory?.(category);
              }
            }}
            className={`rounded-[var(--radius)] p-1.5 cursor-pointer transition-colors ${
              selected ? "" : "hover:ring-1 hover:ring-[var(--border)]"
            }`}
            style={
              selected
                ? {
                    backgroundColor: `color-mix(in srgb, ${CATEGORY_COLORS[category]} 16%, transparent)`,
                  }
                : undefined
            }
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
                    : onTrackToExceed
                      ? "font-semibold text-[var(--chart-warning,var(--foreground))]"
                      : "text-[var(--muted-foreground)]"
                }
              >
                ${spent.toFixed(2)}
                {limit !== undefined ? ` / $${limit.toFixed(2)}` : " (no limit set)"}
              </span>
            </div>
            <div className="h-1.5 flex rounded-full bg-[var(--secondary)] overflow-hidden">
              <div
                className="h-full transition-[width]"
                style={{
                  width: limit ? `${pct}%` : "0%",
                  backgroundColor: overLimit ? "var(--destructive)" : CATEGORY_COLORS[category],
                }}
              />
              {pendingPct > 0 && (
                <div
                  className="h-full transition-[width]"
                  style={{
                    width: `${pendingPct}%`,
                    backgroundColor: `color-mix(in srgb, ${CATEGORY_COLORS[category]} 35%, transparent)`,
                  }}
                />
              )}
            </div>
            {committed > spent && (
              <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                ${(committed - spent).toFixed(2)} still expected
                {onTrackToExceed ? " — on track to exceed this limit" : ""}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
