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

export interface ConfirmTransactionsItem {
  merchant?: string;
  amount?: number;
  type?: "income" | "expense";
  suggested?: Category;
  date?: string;
}

// A single row the user confirmed, in the shape the batch write endpoint (and
// the reused addTransactionsTool) expects.
export interface ConfirmedTransaction {
  merchant: string;
  amount: number;
  type: "income" | "expense";
  category?: Category;
  date?: string;
}

export interface RecordTransactionsResult {
  transactions: unknown[];
  incomeDrift?: { declaredIncome: number; currentIncomeTotal: number };
}

export interface ConfirmTransactionsCardProps {
  items?: ConfirmTransactionsItem[];
  status: "inProgress" | "executing" | "complete";
  respond?: (response: unknown) => void;
  /** Set once the call has completed — including on a replayed transcript. */
  result?: string;
  /**
   * Deterministically persists the confirmed rows (exact categories, no model
   * in the loop) and returns the write result. Provided by the dashboard.
   */
  recordTransactions?: (transactions: ConfirmedTransaction[]) => Promise<RecordTransactionsResult>;
}

// What the card sent back through `respond`, as it comes back on a restored
// transcript — a re-opened conversation no longer has the local state below,
// so recover just enough (decision + count) to render a settled summary rather
// than an inert editable form.
const restoreDecision = (
  result: string | undefined,
): { decision: "confirmed" | "cancelled"; count?: number } | null => {
  if (!result) return null;

  const parsed = parseToolResult<unknown>(result, result);
  const text = typeof parsed === "string" ? parsed : "";

  if (text.startsWith("User cancelled")) return { decision: "cancelled" };

  const count = Number(text.match(/^Recorded (\d+)/)?.[1]);
  if (Number.isFinite(count)) return { decision: "confirmed", count };
  return null;
};

const summarize = ({ merchant, amount, type, category, date }: ConfirmedTransaction): string =>
  `${merchant} ($${amount.toFixed(2)}${type === "income" ? ", income" : `, ${category}`}${date ? `, ${date}` : ""})`;

// Gate 1 (useHumanInTheLoop), batch form: purely client-side confirmation, no
// server suspend. One card for the whole message — one row per parsed
// transaction, showing the agent-determined type (income/expense) read-only
// with an editable category for expenses, plus per-row remove so a mis-split
// row can be dropped and the rest still confirmed.
//
// On confirm the card writes the batch itself via `recordTransactions` (exact
// categories, no model in the loop), then `respond`s with a narration-only
// instruction — the model is explicitly told the rows are already saved and
// must not add them again. This is deliberate: routing the confirmed data back
// through the model let it re-use its own earlier categorizeBatch guess instead
// of the user's edit.
export const ConfirmTransactionsCard = ({
  items,
  status,
  respond,
  result,
  recordTransactions,
}: ConfirmTransactionsCardProps) => {
  // Category overrides are set only when the user actually picks one; the
  // effective value otherwise falls back to the streamed arg, so an
  // incrementally arriving suggested category (see the useRenderTool streaming
  // gotcha in CLAUDE.md) flows through without a sync effect, yet stops the
  // moment the user touches a row. Type is the agent's call, shown read-only.
  const [overrides, setOverrides] = useState<Record<number, { category?: Category }>>({});
  const [removed, setRemoved] = useState<Record<number, boolean>>({});
  const [localDecision, setLocalDecision] = useState<"confirmed" | "cancelled" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = items ?? [];
  const effectiveType = (index: number): "income" | "expense" => rows[index]?.type ?? "expense";
  const effectiveCategory = (index: number): Category | undefined =>
    overrides[index]?.category ?? rows[index]?.suggested;

  const restored = restoreDecision(result);
  const decision = localDecision ?? restored?.decision ?? null;

  if (decision === "confirmed") {
    const count = restored?.count ?? rows.filter((_, index) => !removed[index]).length;
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Recorded {count} transaction{count === 1 ? "" : "s"}.
        </CardContent>
      </Card>
    );
  }

  if (decision === "cancelled") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Transaction confirmation cancelled.
        </CardContent>
      </Card>
    );
  }

  const keptIndexes = rows
    .map((_, index) => index)
    .filter((index) => !removed[index]);

  // Every kept expense row needs a category before the batch can be recorded.
  const missingCategory = keptIndexes.some(
    (index) => effectiveType(index) === "expense" && !effectiveCategory(index),
  );
  const canConfirm = keptIndexes.length > 0 && !missingCategory && !submitting;

  const handleConfirm = async () => {
    if (!canConfirm) return;

    const confirmed: ConfirmedTransaction[] = keptIndexes.map((index) => {
      const row = rows[index];
      const type = effectiveType(index);
      return {
        merchant: row?.merchant ?? "",
        amount: row?.amount ?? 0,
        type,
        ...(type === "expense" ? { category: effectiveCategory(index) } : {}),
        ...(row?.date ? { date: row.date } : {}),
      };
    });

    setSubmitting(true);
    setError(null);
    try {
      const writeResult = await recordTransactions?.(confirmed);
      setLocalDecision("confirmed");

      const drift = writeResult?.incomeDrift;
      respond?.(
        `Recorded ${confirmed.length} transaction${confirmed.length === 1 ? "" : "s"}: ` +
          `${confirmed.map(summarize).join(", ")}. They are already saved — do not add them again; ` +
          `just briefly confirm to the user.` +
          (drift
            ? ` Also, the user's actual income this period ($${drift.currentIncomeTotal}) now differs from ` +
              `their declared income ($${drift.declaredIncome}) by more than 20% — tell them and ask if ` +
              `they'd like to update their declared income.`
            : ""),
      );
    } catch {
      // Leave the card interactive so the user can retry; the HITL call stays
      // pending (no respond) rather than resolving on a failed write.
      setSubmitting(false);
      setError("Couldn't save these transactions. Please try again.");
    }
  };

  const handleCancel = () => {
    setLocalDecision("cancelled");
    respond?.("User cancelled — do not record these transactions.");
  };

  const setRowCategory = (index: number, category: Category) =>
    setOverrides((prev) => ({ ...prev, [index]: { ...prev[index], category } }));
  const removeRow = (index: number) => setRemoved((prev) => ({ ...prev, [index]: true }));

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">
          Confirm {keptIndexes.length} transaction{keptIndexes.length === 1 ? "" : "s"}
        </CardTitle>
        <CardDescription>Review each one, then confirm — remove any that shouldn&apos;t be recorded.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {keptIndexes.map((index) => {
          const row = rows[index];
          const type = effectiveType(index);
          return (
            <div
              key={index}
              className="space-y-2 rounded-[var(--radius)] border border-[var(--border)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {row?.merchant ?? "This transaction"}
                  {row?.amount !== undefined ? ` — $${row.amount.toFixed(2)}` : ""}
                  {row?.date ? ` (${row.date})` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  aria-label="Remove this transaction"
                >
                  ×
                </button>
              </div>
              <span className="inline-block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                {type === "income" ? "Income" : "Expense"}
              </span>
              {type === "expense" && (
                <select
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  value={effectiveCategory(index) ?? ""}
                  onChange={(event) => setRowCategory(index, event.target.value as Category)}
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
              )}
            </div>
          );
        })}
        {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
        {status === "executing" && (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!canConfirm} onClick={handleConfirm}>
              {submitting ? "Recording…" : "Confirm"}
            </Button>
            <Button variant="ghost" className="flex-1" disabled={submitting} onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
