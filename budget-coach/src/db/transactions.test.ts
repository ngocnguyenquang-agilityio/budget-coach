import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// dbClient is a module-level singleton read from TURSO_DATABASE_URL at import
// time, so the env var must be set before the module graph is evaluated —
// hence the dynamic imports below instead of static ones.
const previousDbUrl = process.env.TURSO_DATABASE_URL;
const tmpDir = mkdtempSync(path.join(tmpdir(), "budget-coach-test-"));
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;

const { listTransactions, addTransaction } = await import("./transactions");
const { dbClient } = await import("./client");

describe("listTransactions", () => {
  afterAll(() => {
    dbClient.close();
    if (previousDbUrl === undefined) {
      delete process.env.TURSO_DATABASE_URL;
    } else {
      process.env.TURSO_DATABASE_URL = previousDbUrl;
    }
    // Windows can hold a brief lock on the WAL file after close(); cleanup
    // is best-effort so a lingering lock doesn't fail the suite.
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("returns an empty list for a resourceId with no transactions", async () => {
    const transactions = await listTransactions("resource-empty");
    expect(transactions).toHaveLength(0);
  });

  it("scopes transactions to their resourceId", async () => {
    await addTransaction({
      resourceId: "resource-c",
      date: "2026-01-15",
      merchant: "Groceries",
      amount: 30,
      type: "expense",
      category: "Groceries",
      seedCategory: null,
    });
    await addTransaction({
      resourceId: "resource-d",
      date: "2026-01-15",
      merchant: "Rent",
      amount: 1200,
      type: "expense",
      category: "Housing",
      seedCategory: null,
    });

    const c = await listTransactions("resource-c");
    const d = await listTransactions("resource-d");

    expect(c).toHaveLength(1);
    expect(d).toHaveLength(1);
    expect(c.every((t) => t.resourceId === "resource-c")).toBe(true);
    expect(d.every((t) => t.resourceId === "resource-d")).toBe(true);
  });

  it("orders by createdAt, not by the (possibly shared) business date", async () => {
    const sameDate = "2026-01-15";
    const older = await addTransaction({
      resourceId: "resource-order",
      date: sameDate,
      merchant: "First",
      amount: 10,
      type: "expense",
      category: "Other",
      seedCategory: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await addTransaction({
      resourceId: "resource-order",
      date: sameDate,
      merchant: "Second",
      amount: 20,
      type: "expense",
      category: "Other",
      seedCategory: null,
    });

    const transactions = await listTransactions("resource-order");
    expect(transactions[0].id).toBe(newer.id);
    expect(transactions[1].id).toBe(older.id);
  });
});
