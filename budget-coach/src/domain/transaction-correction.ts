import { z } from "zod";
import { CategorySchema, type Category } from "./categories";
import type { TransactionStatus } from "./transaction";
import type { PendingAmendment } from "./budget-state";
import { periodOf } from "./period";
import { MAX_CORRECTION_ROWS } from "@/constants/transaction-corrections";

// Editing or deleting a recorded Transaction corrects the record — it is not
// a money movement (CONTEXT.md). The User confirms every correction on a card
// that writes it itself; the Coach never can (ADR-0016). This module holds the
// pure rules the corrections route enforces, whatever the model proposed.

// Structural, like AnalyzableTransaction — so this module never imports @/db.
export interface CorrectableTransaction {
  id: string;
  merchant: string;
  note: string | null;
  amount: number;
  date: string;
  type: "income" | "expense" | "transfer";
  category: Category | null;
  status: TransactionStatus;
  fundedByPotId: string | null;
  scheduleId: string | null;
}

// What the card showed the User. A row that no longer matches it has changed
// since, and is refused rather than silently applied to different data.
export const TransactionSnapshotSchema = z.object({
  merchant: z.string(),
  note: z.string().nullable().optional(),
  amount: z.number(),
  date: z.string(),
  type: z.enum(["income", "expense"]),
  category: CategorySchema.nullable().optional(),
});

export type TransactionSnapshot = z.infer<typeof TransactionSnapshotSchema>;

// Strict: Type, Status and the funding Pot are never editable, so a request
// naming one is malformed rather than quietly ignored.
export const TransactionChangesSchema = z.strictObject({
  merchant: z.string().optional(),
  note: z.string().nullable().optional(),
  amount: z.number().optional(),
  date: z.string().optional(),
  category: CategorySchema.optional(),
});

export type TransactionChanges = z.infer<typeof TransactionChangesSchema>;

export const DeleteRowSchema = z.object({ id: z.string().min(1), before: TransactionSnapshotSchema });
export const EditRowSchema = DeleteRowSchema.extend({ changes: TransactionChangesSchema });

export type DeleteRow = z.infer<typeof DeleteRowSchema>;
export type EditRow = z.infer<typeof EditRowSchema>;

// One card = one kind of action (ADR-0016). No threadId: working memory is
// resource-scoped, so a correction needs no chat thread.
export const CorrectionRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("delete"),
    rows: z.array(DeleteRowSchema).min(1).max(MAX_CORRECTION_ROWS),
  }),
  z.object({
    kind: z.literal("edit"),
    rows: z.array(EditRowSchema).min(1).max(MAX_CORRECTION_ROWS),
  }),
]);

export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;
export type CorrectionKind = CorrectionRequest["kind"];

export type CorrectionFailureReason =
  | "not_found"
  | "duplicate"
  | "stale"
  | "transfer"
  | "pot_funded"
  | "expected"
  | "scheduled_delete"
  | "scheduled_period_move"
  | "no_changes"
  | "empty_merchant"
  | "invalid_amount"
  | "invalid_date"
  | "future_date"
  | "category_on_income"
  | "write_failed";

export type CorrectionValidation =
  | { ok: true; id: string; before: TransactionSnapshot; current: CorrectableTransaction; changes?: TransactionChanges }
  | { ok: false; id: string; before: TransactionSnapshot; reason: CorrectionFailureReason };

// YYYY-MM-DD that is also a real calendar day (rejects 2026-02-30).
export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const matchesSnapshot = (current: CorrectableTransaction, before: TransactionSnapshot): boolean =>
  current.merchant === before.merchant &&
  current.amount === before.amount &&
  current.date === before.date &&
  current.type === before.type &&
  current.note === (before.note ?? null) &&
  current.category === (before.category ?? null);

// Rows only the thing that owns them may change (CONTEXT.md boundary note).
const ineligibility = (current: CorrectableTransaction): CorrectionFailureReason | null => {
  if (current.type === "transfer") return "transfer";
  if (current.fundedByPotId) return "pot_funded";
  if (current.status === "expected") return "expected";
  return null;
};

// Validates and normalizes an edit's new values, dropping any that equal the
// current ones. Returns the reason on the first invalid value.
const normalizeChanges = (
  current: CorrectableTransaction,
  changes: TransactionChanges,
  today: string
): { ok: true; changes: TransactionChanges } | { ok: false; reason: CorrectionFailureReason } => {
  const next: TransactionChanges = {};

  if (changes.merchant !== undefined) {
    const merchant = changes.merchant.trim();
    if (!merchant) return { ok: false, reason: "empty_merchant" };
    if (merchant !== current.merchant) next.merchant = merchant;
  }

  if (changes.note !== undefined) {
    const note = changes.note?.trim() || null;
    if (note !== current.note) next.note = note;
  }

  if (changes.amount !== undefined) {
    if (!Number.isFinite(changes.amount) || changes.amount <= 0) return { ok: false, reason: "invalid_amount" };
    if (changes.amount !== current.amount) next.amount = changes.amount;
  }

  if (changes.date !== undefined) {
    if (!isValidIsoDate(changes.date)) return { ok: false, reason: "invalid_date" };
    // ISO dates sort lexicographically. A received Transaction in the future
    // contradicts itself — future money is an expected row.
    if (changes.date > today) return { ok: false, reason: "future_date" };
    if (changes.date !== current.date) next.date = changes.date;
  }

  if (changes.category !== undefined) {
    if (current.type === "income") return { ok: false, reason: "category_on_income" };
    if (changes.category !== current.category) next.category = changes.category;
  }

  if (Object.keys(next).length === 0) return { ok: false, reason: "no_changes" };

  // materializeSchedules regenerates a Schedule's row for any Period left
  // without one, so a scheduled row may not leave its Period.
  if (current.scheduleId && next.date !== undefined && periodOf(next.date) !== periodOf(current.date)) {
    return { ok: false, reason: "scheduled_period_move" };
  }

  return { ok: true, changes: next };
};

// Per-row verdicts for a whole request. Failures are per row, never per batch
// (ADR-0016): one bad row never blocks the others.
export const validateCorrections = (
  request: Pick<CorrectionRequest, "kind" | "rows">,
  currentById: Map<string, CorrectableTransaction>,
  today: string
): CorrectionValidation[] => {
  const seen = new Set<string>();

  return request.rows.map((row): CorrectionValidation => {
    const fail = (reason: CorrectionFailureReason): CorrectionValidation => ({
      ok: false,
      id: row.id,
      before: row.before,
      reason,
    });

    if (seen.has(row.id)) return fail("duplicate");
    seen.add(row.id);

    const current = currentById.get(row.id);
    if (!current) return fail("not_found");

    const ineligible = ineligibility(current);
    if (ineligible) return fail(ineligible);

    if (!matchesSnapshot(current, row.before)) return fail("stale");

    if (request.kind === "delete") {
      if (current.scheduleId) return fail("scheduled_delete");
      return { ok: true, id: row.id, before: row.before, current };
    }

    const normalized = normalizeChanges(current, (row as EditRow).changes, today);
    if (!normalized.ok) return fail(normalized.reason);
    return { ok: true, id: row.id, before: row.before, current, changes: normalized.changes };
  });
};

// Every Period a correction changes: the row's own, plus the destination of a
// date move into another Period.
export const periodsTouched = (current: Pick<CorrectableTransaction, "date">, changes?: TransactionChanges): string[] => {
  const from = periodOf(current.date);
  const to = changes?.date !== undefined ? periodOf(changes.date) : from;
  return from === to ? [from] : [from, to];
};

// Closed Periods that need an ADR-0015 baseline recorded before the write —
// one already pending keeps its original baseline.
export const closedPeriodsNeedingBaseline = (
  periods: string[],
  lastClosedPeriod: string | undefined,
  existing: PendingAmendment[]
): string[] => {
  if (!lastClosedPeriod) return [];
  // YYYY-MM sorts lexicographically, so a plain <= is a correct Period compare.
  return [...new Set(periods)].filter(
    (period) => period <= lastClosedPeriod && !existing.some((entry) => entry.period === period)
  );
};

// Whether the applied corrections could move Forecast Income (and so the Cap)
// for `period`: an Income row deleted, or its amount or date changed, where
// either end of it sits in that Period.
export const touchesForecastIncome = (
  applied: { current: Pick<CorrectableTransaction, "type" | "date">; changes?: TransactionChanges }[],
  period: string
): boolean =>
  applied.some(
    ({ current, changes }) =>
      current.type === "income" &&
      (changes === undefined || changes.amount !== undefined || changes.date !== undefined) &&
      periodsTouched(current, changes).includes(period)
  );
