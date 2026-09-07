"use client";

import { computePotProgress, type SavingsPot } from "@/domain/savings-pot";

const currentPeriod = () => new Date().toISOString().slice(0, 7);

// Shared presentational bar for a single Savings Pot, used both in the
// dashboard's "Savings pots" section and the chat result card.
export const SavingsPotProgress = ({ pot }: { pot: SavingsPot }) => {
  const { pct, remaining, status, requiredPerMonth } = computePotProgress(pot, currentPeriod());

  const barColor =
    status === "complete"
      ? "var(--chart-positive)"
      : status === "behind"
        ? "var(--destructive)"
        : "var(--foreground)";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <span className="truncate">{pot.name}</span>
          {status === "complete" && (
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--chart-positive)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--chart-positive)" }}>
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
          ${pot.savedSoFar.toFixed(2)} / ${pot.targetAmount.toFixed(2)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--secondary)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      <div className="mt-1 text-xs text-[var(--muted-foreground)]">
        {status === "complete"
          ? "Target reached 🎉"
          : `$${remaining.toFixed(2)} to go${pot.deadline ? ` · by ${pot.deadline}` : ""}${
              requiredPerMonth !== undefined ? ` · $${requiredPerMonth.toFixed(2)}/mo` : ""
            }`}
      </div>
    </div>
  );
};
