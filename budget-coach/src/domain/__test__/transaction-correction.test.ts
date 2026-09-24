import { describe, expect, it } from "vitest";
import {
  CorrectionRequestSchema,
  closedPeriodsNeedingBaseline,
  isValidIsoDate,
  periodsTouched,
  touchesForecastIncome,
  validateCorrections,
  type CorrectableTransaction,
  type TransactionChanges,
  type TransactionSnapshot,
} from "../transaction-correction";

const TODAY = "2026-09-24";

const row = (overrides: Partial<CorrectableTransaction> = {}): CorrectableTransaction => ({
  id: "t1",
  merchant: "Grab",
  note: null,
  amount: 21,
  date: "2026-09-10",
  type: "expense",
  category: "Transport",
  status: "received",
  fundedByPotId: null,
  scheduleId: null,
  ...overrides,
});

const snapshotOf = (current: CorrectableTransaction): TransactionSnapshot => ({
  merchant: current.merchant,
  note: current.note,
  amount: current.amount,
  date: current.date,
  type: current.type === "transfer" ? "expense" : current.type,
  category: current.category,
});

const byId = (...rows: CorrectableTransaction[]) => new Map(rows.map((entry) => [entry.id, entry]));

const deleteOne = (current: CorrectableTransaction, before = snapshotOf(current)) =>
  validateCorrections({ kind: "delete", rows: [{ id: current.id, before }] }, byId(current), TODAY)[0];

const editOne = (current: CorrectableTransaction, changes: TransactionChanges, before = snapshotOf(current)) =>
  validateCorrections({ kind: "edit", rows: [{ id: current.id, before, changes }] }, byId(current), TODAY)[0];

const reasonOf = (result: ReturnType<typeof deleteOne>) => (result.ok ? "ok" : result.reason);

describe("validateCorrections", () => {
  it("accepts a plain delete and a plain edit", () => {
    expect(reasonOf(deleteOne(row()))).toBe("ok");
    const edit = editOne(row(), { amount: 12 });
    expect(edit.ok && edit.changes).toEqual({ amount: 12 });
  });

  it("reports a missing row as not_found", () => {
    const result = validateCorrections(
      { kind: "delete", rows: [{ id: "ghost", before: snapshotOf(row()) }] },
      byId(row()),
      TODAY
    )[0];
    expect(reasonOf(result)).toBe("not_found");
  });

  it("reports a repeated id as duplicate on its second occurrence only", () => {
    const current = row();
    const results = validateCorrections(
      { kind: "delete", rows: [{ id: "t1", before: snapshotOf(current) }, { id: "t1", before: snapshotOf(current) }] },
      byId(current),
      TODAY
    );
    expect(results.map(reasonOf)).toEqual(["ok", "duplicate"]);
  });

  it.each([
    ["amount", { amount: 22 }],
    ["merchant", { merchant: "Grab Food" }],
    ["date", { date: "2026-09-11" }],
    ["category", { category: "Dining" as const }],
    ["note", { note: "airport" }],
  ])("reports a snapshot differing on %s as stale", (_, diff) => {
    const current = row();
    expect(reasonOf(deleteOne(current, { ...snapshotOf(current), ...diff }))).toBe("stale");
  });

  it("treats an omitted note/category in the snapshot as null", () => {
    const current = row({ type: "income", category: null });
    const { note: _note, category: _category, ...before } = snapshotOf(current);
    expect(reasonOf(deleteOne(current, before))).toBe("ok");
  });

  it.each([
    ["transfer", row({ type: "transfer", category: null })],
    ["pot_funded", row({ fundedByPotId: "pot-1" })],
    ["expected", row({ status: "expected" })],
  ])("refuses a %s row for both delete and edit", (reason, current) => {
    expect(reasonOf(deleteOne(current))).toBe(reason);
    expect(reasonOf(editOne(current, { amount: 5 }))).toBe(reason);
  });

  describe("a confirmed row from a Recurring Schedule", () => {
    const scheduled = row({ scheduleId: "s1" });

    it("can't be deleted", () => {
      expect(reasonOf(deleteOne(scheduled))).toBe("scheduled_delete");
    });

    it("can move within its Period", () => {
      expect(reasonOf(editOne(scheduled, { date: "2026-09-02" }))).toBe("ok");
    });

    it("can't move to another Period", () => {
      expect(reasonOf(editOne(scheduled, { date: "2026-08-30" }))).toBe("scheduled_period_move");
    });

    it("can have its amount corrected", () => {
      expect(reasonOf(editOne(scheduled, { amount: 30 }))).toBe("ok");
    });
  });

  it.each([
    [{ amount: 0 }, "invalid_amount"],
    [{ amount: -4 }, "invalid_amount"],
    [{ amount: Number.NaN }, "invalid_amount"],
    [{ date: "2026-02-30" }, "invalid_date"],
    [{ date: "2026/09/01" }, "invalid_date"],
    [{ date: "2026-09-25" }, "future_date"],
    [{ merchant: "   " }, "empty_merchant"],
    [{}, "no_changes"],
    [{ amount: 21, merchant: "Grab" }, "no_changes"],
  ] as [TransactionChanges, string][])("refuses %j with %s", (changes, reason) => {
    expect(reasonOf(editOne(row(), changes))).toBe(reason);
  });

  it("accepts today and a date years back", () => {
    expect(reasonOf(editOne(row(), { date: TODAY }))).toBe("ok");
    expect(reasonOf(editOne(row(), { date: "2021-03-04" }))).toBe("ok");
  });

  it("refuses a category on an income row", () => {
    expect(reasonOf(editOne(row({ type: "income", category: null }), { category: "Other" }))).toBe(
      "category_on_income"
    );
  });

  it("normalizes: trims the merchant, blanks a note to null, drops unchanged fields", () => {
    const result = editOne(row({ note: "airport" }), { merchant: "  Grab Car ", note: "  ", amount: 21 });
    expect(result.ok && result.changes).toEqual({ merchant: "Grab Car", note: null });
  });

  it("keeps each row's verdict independent", () => {
    const good = row({ id: "a" });
    const potFunded = row({ id: "b", fundedByPotId: "pot" });
    const results = validateCorrections(
      {
        kind: "delete",
        rows: [
          { id: "a", before: snapshotOf(good) },
          { id: "b", before: snapshotOf(potFunded) },
        ],
      },
      byId(good, potFunded),
      TODAY
    );
    expect(results.map(reasonOf)).toEqual(["ok", "pot_funded"]);
  });
});

describe("isValidIsoDate", () => {
  it("accepts real days and rejects impossible ones", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-9-1")).toBe(false);
  });
});

describe("periodsTouched", () => {
  it("is one Period for a same-month move and two for a cross-month move", () => {
    expect(periodsTouched({ date: "2026-09-10" }, { date: "2026-09-01" })).toEqual(["2026-09"]);
    expect(periodsTouched({ date: "2026-09-10" }, { date: "2026-08-31" })).toEqual(["2026-09", "2026-08"]);
    expect(periodsTouched({ date: "2026-09-10" })).toEqual(["2026-09"]);
  });
});

describe("closedPeriodsNeedingBaseline", () => {
  it("returns nothing when no Period has been closed", () => {
    expect(closedPeriodsNeedingBaseline(["2026-07"], undefined, [])).toEqual([]);
  });

  it("includes lastClosedPeriod itself and skips open and already-pending Periods", () => {
    expect(
      closedPeriodsNeedingBaseline(
        ["2026-06", "2026-07", "2026-08", "2026-09", "2026-07"],
        "2026-08",
        [{ period: "2026-06", netSavingsAtClose: 10 }]
      )
    ).toEqual(["2026-07", "2026-08"]);
  });
});

describe("touchesForecastIncome", () => {
  const income = { type: "income" as const, date: "2026-09-01" };

  it("is false for an expense", () => {
    expect(touchesForecastIncome([{ current: { type: "expense", date: "2026-09-01" } }], "2026-09")).toBe(false);
  });

  it("is false for income in a past Period", () => {
    expect(touchesForecastIncome([{ current: { type: "income", date: "2026-07-01" } }], "2026-09")).toBe(false);
  });

  it("is true for deleting, re-amounting, or moving income into or out of the Period", () => {
    expect(touchesForecastIncome([{ current: income }], "2026-09")).toBe(true);
    expect(touchesForecastIncome([{ current: income, changes: { amount: 100 } }], "2026-09")).toBe(true);
    expect(touchesForecastIncome([{ current: income, changes: { date: "2026-08-31" } }], "2026-09")).toBe(true);
    expect(
      touchesForecastIncome([{ current: { type: "income", date: "2026-08-31" }, changes: { date: "2026-09-01" } }], "2026-09")
    ).toBe(true);
  });

  it("is false for a rename that leaves the amount and date alone", () => {
    expect(touchesForecastIncome([{ current: income, changes: { merchant: "Payroll" } }], "2026-09")).toBe(false);
  });
});

describe("CorrectionRequestSchema", () => {
  const before = snapshotOf(row());

  it("rejects more than 25 rows", () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({ id: `t${index}`, before }));
    expect(CorrectionRequestSchema.safeParse({ kind: "delete", rows }).success).toBe(false);
  });

  it("needs no threadId", () => {
    expect(CorrectionRequestSchema.safeParse({ kind: "delete", rows: [{ id: "t1", before }] }).success).toBe(true);
  });

  it("rejects an edit that tries to change Type", () => {
    const result = CorrectionRequestSchema.safeParse({
      kind: "edit",
      rows: [{ id: "t1", before, changes: { type: "income" } }],
    });
    expect(result.success).toBe(false);
  });
});
