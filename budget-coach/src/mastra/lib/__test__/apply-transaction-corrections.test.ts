import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// dbClient reads TURSO_DATABASE_URL at import time, so it must be set before
// the module graph loads — hence the dynamic imports.
const previousDbUrl = process.env.TURSO_DATABASE_URL;
const tmpDir = mkdtempSync(path.join(tmpdir(), "budget-coach-test-"));
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;

const { addTransaction, getTransaction } = await import("@/db/transactions");
const { dbClient } = await import("@/db/client");
const { applyTransactionCorrections } = await import("../apply-transaction-corrections");
const { currentPeriod } = await import("@/domain/period");
type Transaction = import("@/db/transactions").Transaction;

afterAll(() => {
  dbClient.close();
  if (previousDbUrl === undefined) {
    delete process.env.TURSO_DATABASE_URL;
  } else {
    process.env.TURSO_DATABASE_URL = previousDbUrl;
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

// Resource working memory backed by a plain string.
const contextFor = (resourceId: string, initial: Record<string, unknown> = {}) => {
  let stored: string | null = JSON.stringify(initial);
  return {
    context: {
      resourceId,
      workingMemory: {
        get: async () => stored,
        set: async (workingMemory: string) => {
          stored = workingMemory;
        },
      },
    },
    state: () => JSON.parse(stored ?? "{}") as Record<string, unknown>,
  };
};

const seed = (resourceId: string, overrides: Partial<Transaction> = {}) =>
  addTransaction({
    resourceId,
    date: "2026-06-10",
    merchant: "Grab",
    amount: 21,
    type: "expense",
    category: "Transport",
    seedCategory: null,
    ...overrides,
  });

const snapshot = (row: Transaction) => ({
  merchant: row.merchant,
  note: row.note,
  amount: row.amount,
  date: row.date,
  type: row.type as "income" | "expense",
  category: row.category,
});

describe("applyTransactionCorrections", () => {
  it("applies the good rows and reports the rest, one verdict per row", async () => {
    const { context } = contextFor("r-partial");
    const good = await seed("r-partial");
    const potFunded = await seed("r-partial", { fundedByPotId: "pot-1" });
    const stale = await seed("r-partial", { merchant: "Starbucks" });

    const result = await applyTransactionCorrections(
      {
        kind: "delete",
        rows: [
          { id: good.id, before: snapshot(good) },
          { id: potFunded.id, before: snapshot(potFunded) },
          { id: stale.id, before: { ...snapshot(stale), amount: 5 } },
        ],
      },
      context
    );

    expect(result.applied.map((row) => row.id)).toEqual([good.id]);
    expect(result.failed.map((row) => [row.id, row.reason])).toEqual([
      [potFunded.id, "pot_funded"],
      [stale.id, "stale"],
    ]);
    expect(result.failed[1].message).toBe("changed since shown");
    expect(await getTransaction("r-partial", good.id)).toBeNull();
    expect(await getTransaction("r-partial", stale.id)).not.toBeNull();
  });

  it("records an ADR-0015 baseline only for a closed Period an applied row touched", async () => {
    const { context, state } = contextFor("r-closed", { lastClosedPeriod: "2026-07" });
    await seed("r-closed", { type: "income", category: null, merchant: "Salary", amount: 3000, date: "2026-06-01" });
    const june = await seed("r-closed", { date: "2026-06-10", amount: 100 });
    const julyStale = await seed("r-closed", { date: "2026-07-10" });

    const result = await applyTransactionCorrections(
      {
        kind: "edit",
        rows: [
          { id: june.id, before: snapshot(june), changes: { amount: 40 } },
          { id: julyStale.id, before: { ...snapshot(julyStale), merchant: "Uber" }, changes: { amount: 1 } },
        ],
      },
      context
    );

    expect(result.amendedPeriods).toEqual(["2026-06"]);
    // Net Savings before the edit: 3000 income − 100 expense.
    expect(state().pendingAmendments).toEqual([{ period: "2026-06", netSavingsAtClose: 2900 }]);
    expect(result.refitNeeded).toBeUndefined();
  });

  it("baselines both closed Periods when a row moves between them, keeping an existing entry", async () => {
    const existing = { period: "2026-05", netSavingsAtClose: 7 };
    const { context, state } = contextFor("r-move", { lastClosedPeriod: "2026-07", pendingAmendments: [existing] });
    const row = await seed("r-move", { date: "2026-05-20" });

    const result = await applyTransactionCorrections(
      { kind: "edit", rows: [{ id: row.id, before: snapshot(row), changes: { date: "2026-06-02" } }] },
      context
    );

    expect(result.amendedPeriods).toEqual(["2026-06"]);
    expect(state().pendingAmendments).toEqual([existing, { period: "2026-06", netSavingsAtClose: 0 }]);
  });

  it("flags a refit when cutting this month's income leaves limits above the Cap, but not for an expense", async () => {
    const period = currentPeriod();
    const { context } = contextFor("r-refit", { categoryLimits: { Groceries: 1000 } });
    const salary = await seed("r-refit", {
      type: "income",
      category: null,
      merchant: "Salary",
      amount: 3000,
      date: `${period}-01`,
    });
    const coffee = await seed("r-refit", { date: `${period}-01`, category: "Dining", merchant: "Coffee", amount: 5 });

    const expense = await applyTransactionCorrections(
      { kind: "edit", rows: [{ id: coffee.id, before: snapshot(coffee), changes: { amount: 4 } }] },
      context
    );
    expect(expense.refitNeeded).toBeUndefined();

    const income = await applyTransactionCorrections(
      { kind: "edit", rows: [{ id: salary.id, before: snapshot(salary), changes: { amount: 800 } }] },
      context
    );
    expect(income.refitNeeded).toBe(true);
  });
});
