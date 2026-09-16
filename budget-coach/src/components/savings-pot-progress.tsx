"use client";

import { computePotProgress, type SavingsPot } from "@/domain/savings-pot";
import { currentPeriod } from "@/domain/period";

// Shared presentational bar for a single Savings Pot, used both in the
// dashboard's "Savings pots" section and the chat result card.
//
// A pot is one of two shapes (ADR-0013): target-driven, which has a bar and a
// remaining figure, or rate-driven, which has neither — it just accumulates.
export const SavingsPotProgress = ({ pot }: { pot: SavingsPot }) => {
  const { pct, remaining, status, rate, balance } = computePotProgress(pot, currentPeriod());

  const barColor =
    status === "complete"
      ? "var(--budget-chart-positive)"
      : status === "behind"
        ? "var(--destructive)"
        : "var(--foreground)";

  const rateLabel = rate > 0 ? `$${rate.toFixed(2)}/mo` : null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <span className="truncate">{pot.name}</span>
          {status === "complete" && (
            <span
              className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--budget-chart-positive)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--budget-chart-positive)" }}
            >
              Complete
            </span>
          )}
          {status === "behind" && (
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--destructive)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--destructive)]">
              Behind
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">
          ${balance.toFixed(2)}
          {pot.kind === "target" ? ` / $${pot.targetAmount.toFixed(2)}` : ""}
        </span>
      </div>

      {pot.kind === "target" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--secondary)]">
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${pct ?? 0}%`, backgroundColor: barColor }}
          />
        </div>
      )}

      <div className="mt-1 text-xs text-[var(--muted-foreground)]">
        {pot.kind === "rate"
          ? `Saving ${rateLabel} · no end date`
          : status === "complete"
            ? "Target reached 🎉"
            : `$${(remaining ?? 0).toFixed(2)} to go${pot.deadline ? ` · by ${pot.deadline}` : ""}${
                rateLabel ? ` · ${rateLabel}` : " · no deadline set"
              }`}
      </div>
    </div>
  );
};
