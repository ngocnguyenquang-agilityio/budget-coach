"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/domain/analysis";
import type { Target } from "@/domain/funding-plan";
import { CATEGORIES, type Category, type CategoryLimits } from "@/domain/categories";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface FundingPlanCardProps {
  proposedLimits: CategoryLimits;
  analysis: AnalysisResult;
  // Declared Income − required/month (ADR-0008). The ceiling the edited total
  // must stay within — same role as `cap` on the Monthly Review card.
  cap?: number;
  target: Target;
  requiredPerMonth: number;
  onApprove: (edits: CategoryLimits) => void;
  onReject: () => void;
}

type Mode = "amount" | "percent";

// Forward-looking counterpart to MonthlyReviewCard (parallel copy per ADR-0008,
// not a shared component). Same edit/approve mechanics — each category is a
// dollar amount or a % of what's available, converted to dollars on submit —
// with a header summarizing the Target being funded and the required monthly
// set-aside the reduced limits make room for.
export const FundingPlanCard = ({
  proposedLimits,
  analysis,
  cap,
  target,
  requiredPerMonth,
  onApprove,
  onReject,
}: FundingPlanCardProps) => {
  const [resolved, setResolved] = useState(false);
  const [values, setValues] = useState<Record<Category, string>>(() =>
    Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        proposedLimits[category] !== undefined ? String(proposedLimits[category]) : "",
      ]),
    ) as Record<Category, string>,
  );
  const [modes, setModes] = useState<Record<Category, Mode>>(() =>
    Object.fromEntries(CATEGORIES.map((category) => [category, "amount" as Mode])) as Record<
      Category,
      Mode
    >,
  );

  if (resolved) return null;

  const totals = new Map(
    analysis.categoryTotals.map((entry) => [entry.category, entry.total]),
  );

  const toggleMode = (category: Category) => {
    if (cap === undefined || cap <= 0) return;
    const currentMode = modes[category];
    const nextMode: Mode = currentMode === "amount" ? "percent" : "amount";
    const raw = values[category].trim();
    let nextRaw = raw;
    if (raw !== "" && Number.isFinite(Number(raw))) {
      const dollarValue = currentMode === "percent" ? (Number(raw) / 100) * cap : Number(raw);
      nextRaw =
        nextMode === "percent"
          ? String(Math.round((dollarValue / cap) * 10000) / 100)
          : String(Math.round(dollarValue * 100) / 100);
    }
    setModes((current) => ({ ...current, [category]: nextMode }));
    setValues((current) => ({ ...current, [category]: nextRaw }));
  };

  const parsed = CATEGORIES.map((category) => {
    const raw = values[category].trim();
    const mode = modes[category];
    const rawNumber = Number(values[category]);
    const numberOk = Number.isFinite(rawNumber) && rawNumber >= 0;
    const canConvert = mode === "amount" || (cap !== undefined && cap > 0);
    const valid = raw === "" || (numberOk && canConvert);
    const dollarValue = mode === "percent" && cap !== undefined ? (rawNumber / 100) * cap : rawNumber;
    return { category, raw, mode, rawNumber, dollarValue, valid };
  });

  const invalidCategories = parsed
    .filter(({ raw, valid }) => raw !== "" && !valid)
    .map(({ category }) => category);

  const total = parsed
    .filter(({ raw, valid }) => raw !== "" && valid)
    .reduce((sum, { dollarValue }) => sum + dollarValue, 0);

  const overCap = cap !== undefined && total > cap;
  const canApprove = invalidCategories.length === 0 && !overCap;

  const handleApprove = () => {
    if (!canApprove) return;
    const edits: CategoryLimits = Object.fromEntries(
      parsed
        .filter(({ raw }) => raw !== "")
        .map(({ category, dollarValue }) => [category, Math.round(dollarValue * 100) / 100]),
    );
    setResolved(true);
    onApprove(edits);
  };

  const handleReject = () => {
    setResolved(true);
    onReject();
  };

  const goalLabel =
    target.kind === "savings"
      ? `save $${target.amount}${target.deadline ? ` by ${target.deadline}` : ""}`
      : `afford a $${target.amount} purchase${target.deadline ? ` by ${target.deadline}` : ""}`;

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">Funding Plan</CardTitle>
        <CardDescription>
          To {goalLabel}, you'd set aside ${requiredPerMonth}/mo. Here are reduced limits that free that up —
          adjust any, then approve. Enter a dollar amount or switch to % of what's available.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2 text-sm">
          {parsed.map(({ category, mode, raw, rawNumber, dollarValue, valid }) => {
            const equivalent =
              raw !== "" && valid && cap !== undefined && cap > 0
                ? mode === "percent"
                  ? `= $${dollarValue.toFixed(2)}`
                  : `= ${((rawNumber / cap) * 100).toFixed(2)}%`
                : null;

            return (
              <li key={category} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div>{category}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    ${(totals.get(category) ?? 0).toFixed(2)} spent
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1">
                    <div className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--border)] text-xs">
                      <button
                        type="button"
                        onClick={() => mode !== "amount" && toggleMode(category)}
                        className={`px-1.5 py-1 ${mode === "amount" ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-[var(--background)]"}`}
                      >
                        $
                      </button>
                      <button
                        type="button"
                        disabled={cap === undefined || cap <= 0}
                        onClick={() => mode !== "percent" && toggleMode(category)}
                        className={`px-1.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${mode === "percent" ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-[var(--background)]"}`}
                      >
                        %
                      </button>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-24 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-right text-sm"
                      placeholder="No limit"
                      value={values[category]}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [category]: event.target.value }))
                      }
                    />
                  </div>
                  {equivalent && (
                    <div className="text-xs text-[var(--muted-foreground)]">{equivalent}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className={`text-sm ${overCap ? "text-red-600" : "text-[var(--muted-foreground)]"}`}>
          Total: ${total.toFixed(2)}
          {cap !== undefined ? ` / $${cap.toFixed(2)} available` : ""}
        </div>
        {invalidCategories.length > 0 && (
          <p className="text-sm text-red-600">Enter a valid non-negative amount for every filled-in category.</p>
        )}
        {overCap && (
          <p className="text-sm text-red-600">Total exceeds what's available — lower one or more limits.</p>
        )}

        <div className="flex gap-2">
          <Button className="flex-1" disabled={!canApprove} onClick={handleApprove}>
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
