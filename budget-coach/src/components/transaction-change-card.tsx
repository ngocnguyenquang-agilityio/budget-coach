"use client";

import { useState } from "react";
import type {
  CorrectionKind,
  DeleteRow,
  EditRow,
  TransactionChanges,
  TransactionSnapshot,
} from "@/domain/transaction-correction";
import type { CorrectionResult } from "@/mastra/lib/apply-transaction-corrections";
import { MAX_CORRECTION_ROWS } from "@/constants/transaction-corrections";
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

// Args stream in incrementally, so every field may still be missing.
export interface StreamedCorrectionRow {
  id?: string;
  before?: Partial<TransactionSnapshot>;
  changes?: Partial<TransactionChanges>;
}

export type ApplyCorrections = (
  kind: CorrectionKind,
  rows: DeleteRow[] | EditRow[],
) => Promise<CorrectionResult>;

export interface TransactionChangeCardProps {
  kind: CorrectionKind;
  rows?: StreamedCorrectionRow[];
  status: "inProgress" | "executing" | "complete";
  respond?: (response: unknown) => void;
  /** Set once the call has completed — including on a replayed transcript. */
  result?: string;
  /** Writes the ticked rows (no model in the loop). Provided by the dashboard. */
  applyCorrections?: ApplyCorrections;
}

interface Outcome {
  applied: CorrectionResult["applied"];
  failed: CorrectionResult["failed"];
  skipped: number;
}

const money = (amount: number | undefined) => (amount === undefined ? "" : `$${amount.toFixed(2)}`);

const isComplete = (row: StreamedCorrectionRow, kind: CorrectionKind): boolean =>
  !!row.id &&
  row.before?.merchant !== undefined &&
  row.before.amount !== undefined &&
  row.before.date !== undefined &&
  row.before.type !== undefined &&
  (kind === "delete" || row.changes !== undefined);

const toRequestRow = (row: StreamedCorrectionRow, kind: CorrectionKind): DeleteRow | EditRow => {
  const before: TransactionSnapshot = {
    merchant: row.before!.merchant!,
    note: row.before!.note ?? null,
    amount: row.before!.amount!,
    date: row.before!.date!,
    type: row.before!.type!,
    category: row.before!.category ?? null,
  };
  return kind === "delete" ? { id: row.id!, before } : { id: row.id!, before, changes: row.changes ?? {} };
};

// What the card sent back through `respond`, recovered on a restored transcript
// so a re-opened conversation shows the settled summary, not a live form.
const restoreDecision = (
  result: string | undefined,
): { decision: "applied"; outcome: Outcome } | { decision: "cancelled" } | null => {
  const parsed = parseToolResult<Record<string, unknown> | null>(result, null);
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.decision === "cancelled" || parsed.cancelled === true) return { decision: "cancelled" };
  if (parsed.decision !== "applied") return null;
  return {
    decision: "applied",
    outcome: {
      applied: Array.isArray(parsed.applied) ? (parsed.applied as Outcome["applied"]) : [],
      failed: Array.isArray(parsed.failed) ? (parsed.failed as Outcome["failed"]) : [],
      skipped: typeof parsed.skipped === "number" ? parsed.skipped : 0,
    },
  };
};

const FIELD_LABELS: Record<keyof TransactionChanges, string> = {
  merchant: "Name",
  note: "Note",
  amount: "Amount",
  date: "Date",
  category: "Category",
};

const formatField = (field: keyof TransactionChanges, value: unknown): string => {
  if (field === "amount" && typeof value === "number") return money(value);
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

// Gate for correcting the record (ADR-0016): purely client-side, no server
// suspend. One card per kind of action — every row starts ticked and the User
// may untick any. On Confirm the card writes the ticked rows itself, then
// `respond`s with the per-row outcome; the Coach never makes the change.
export const TransactionChangeCard = ({
  kind,
  rows,
  status,
  respond,
  result,
  applyCorrections,
}: TransactionChangeCardProps) => {
  const [unticked, setUnticked] = useState<Record<number, boolean>>({});
  const [localDecision, setLocalDecision] = useState<"applied" | "cancelled" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useHitlTimeout(status, respond, setLocalDecision);

  const allRows = rows ?? [];
  const restored = restoreDecision(result);
  const decision = localDecision ?? restored?.decision ?? null;
  const verb = kind === "delete" ? "Deleted" : "Updated";

  if (decision === "applied") {
    const settled = outcome ?? (restored?.decision === "applied" ? restored.outcome : null);
    const applied = settled?.applied.length ?? 0;
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="space-y-1 pt-6 text-sm text-[var(--muted-foreground)]">
          <p>
            {verb} {applied} transaction{applied === 1 ? "" : "s"}
            {settled && settled.skipped > 0 ? ` · ${settled.skipped} left unticked` : ""}.
          </p>
          {settled?.failed.map((row) => (
            <p key={row.id} className="text-[var(--destructive)]">
              Not changed: {row.merchant} {money(row.amount)} ({row.message})
            </p>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (decision === "cancelled") {
    return (
      <Card className="mx-auto my-2 w-full max-w-md">
        <CardContent className="pt-6 text-sm text-[var(--muted-foreground)]">
          Cancelled — nothing was changed.
        </CardContent>
      </Card>
    );
  }

  const tooMany = allRows.length > MAX_CORRECTION_ROWS;
  const tickedIndexes = allRows
    .map((_, index) => index)
    .filter((index) => !unticked[index] && isComplete(allRows[index], kind));
  const canConfirm = status === "executing" && tickedIndexes.length > 0 && !tooMany && !submitting;

  const handleConfirm = async () => {
    if (!canConfirm || !applyCorrections) return;

    const requestRows = tickedIndexes.map((index) => toRequestRow(allRows[index], kind));
    const skipped = allRows.length - tickedIndexes.length;

    setSubmitting(true);
    setError(null);
    try {
      const written = await applyCorrections(kind, requestRows as DeleteRow[] | EditRow[]);
      const settled = { applied: written.applied, failed: written.failed, skipped };
      setOutcome(settled);
      setLocalDecision("applied");
      respond?.({
        decision: "applied",
        kind,
        ...settled,
        ...(written.amendedPeriods ? { amendedPeriods: written.amendedPeriods } : {}),
        ...(written.refitNeeded ? { refitNeeded: true } : {}),
        instruction:
          "These changes are already saved by the card — do not try to make them again. Briefly confirm what changed." +
          (settled.failed.length > 0
            ? " In one line, tell the user which rows were NOT changed and why (the failed list), and offer — do not run — a fresh look."
            : "") +
          " There is no undo, so do not offer one.",
      });
    } catch {
      // Leave the card interactive so the user can retry; no respond on a
      // failed request.
      setSubmitting(false);
      setError("Couldn't save these changes. Please try again.");
    }
  };

  const handleCancel = () => {
    setLocalDecision("cancelled");
    respond?.({ decision: "cancelled", kind, instruction: "The user cancelled. Nothing was changed." });
  };

  const toggle = (index: number) => setUnticked((prev) => ({ ...prev, [index]: !prev[index] }));

  return (
    <Card className="mx-auto my-2 w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-base">
          {kind === "delete" ? "Delete" : "Change"} {tickedIndexes.length} transaction
          {tickedIndexes.length === 1 ? "" : "s"}?
        </CardTitle>
        <CardDescription>
          {kind === "delete"
            ? "These will be removed from your records. Untick any you want to keep."
            : "Review each change. Untick any you don't want made."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {allRows.map((row, index) => {
          const ready = isComplete(row, kind);
          const changedFields = (Object.keys(row.changes ?? {}) as (keyof TransactionChanges)[]).filter(
            (field) => field in FIELD_LABELS,
          );
          return (
            <label
              key={row.id ?? index}
              className="flex cursor-pointer gap-3 rounded-[var(--radius)] border border-[var(--border)] p-3"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={ready && !unticked[index]}
                disabled={!ready || status !== "executing" || submitting}
                onChange={() => toggle(index)}
              />
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className={kind === "delete" && !unticked[index] ? "font-medium line-through" : "font-medium"}>
                  {row.before?.merchant ?? "This transaction"}
                  {row.before?.amount !== undefined ? ` — ${money(row.before.amount)}` : ""}
                  {row.before?.date ? ` (${row.before.date})` : ""}
                </p>
                {kind === "delete" && row.before?.category && (
                  <p className="text-xs text-[var(--muted-foreground)]">{row.before.category}</p>
                )}
                {kind === "edit" &&
                  changedFields.map((field) => (
                    <p key={field} className="text-xs">
                      <span className="text-[var(--muted-foreground)]">{FIELD_LABELS[field]}: </span>
                      <span className="text-[var(--muted-foreground)] line-through">
                        {formatField(field, row.before?.[field as keyof TransactionSnapshot])}
                      </span>
                      {" → "}
                      <span className="font-medium">{formatField(field, row.changes?.[field])}</span>
                    </p>
                  ))}
              </div>
            </label>
          );
        })}
        {tooMany && (
          <p className="text-sm text-[var(--destructive)]">
            Too many to confirm at once — at most {MAX_CORRECTION_ROWS}.
          </p>
        )}
        {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
        {status === "executing" && (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={kind === "delete" ? "destructive" : "default"}
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              {submitting ? "Saving…" : kind === "delete" ? "Delete" : "Confirm"}
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
