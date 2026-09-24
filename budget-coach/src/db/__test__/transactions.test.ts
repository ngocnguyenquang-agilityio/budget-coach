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

const { listTransactions, addTransaction, getTransaction, updateTransactionIfUnchanged, deleteTransactionIfUnchanged } =
  await import("../transactions");
const { dbClient } = await import("../client");

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

  it("round-trips a transfer's transferDirection through the migrated column", async () => {
    const inserted = await addTransaction({
      resourceId: "resource-transfer",
      date: "2026-01-15",
      merchant: "Laptop",
      amount: 100,
      type: "transfer",
      transferDirection: "to_pot",
      category: null,
      seedCategory: null,
    });

    expect(inserted.transferDirection).toBe("to_pot");

    const [stored] = await listTransactions("resource-transfer");
    expect(stored.type).toBe("transfer");
    expect(stored.transferDirection).toBe("to_pot");
    expect(stored.category).toBeNull();
  });

  describe("corrections guarded by the shown snapshot (ADR-0016)", () => {
    const seed = (resourceId: string, overrides: Record<string, unknown> = {}) =>
      addTransaction({
        resourceId,
        date: "2026-09-10",
        merchant: "Grab",
        amount: 21,
        type: "expense",
        category: "Transport",
        seedCategory: null,
        ...overrides,
      });
    const before = { merchant: "Grab", note: null, amount: 21, date: "2026-09-10", type: "expense" as const, category: "Transport" as const };

    it("updates a row that still matches, and only the whitelisted columns", async () => {
      const inserted = await seed("resource-edit");
      expect(await updateTransactionIfUnchanged("resource-edit", inserted.id, before, { amount: 12, note: "airport" })).toBe(true);
      const stored = await getTransaction("resource-edit", inserted.id);
      expect(stored).toMatchObject({ amount: 12, note: "airport", merchant: "Grab", category: "Transport" });
    });

    it("leaves a row untouched when the snapshot no longer matches", async () => {
      const inserted = await seed("resource-edit-stale");
      expect(
        await updateTransactionIfUnchanged("resource-edit-stale", inserted.id, { ...before, amount: 99 }, { amount: 12 })
      ).toBe(false);
      expect((await getTransaction("resource-edit-stale", inserted.id))?.amount).toBe(21);
    });

    it("never touches another user's row", async () => {
      const inserted = await seed("resource-owner");
      expect(await updateTransactionIfUnchanged("resource-intruder", inserted.id, before, { amount: 1 })).toBe(false);
      expect(await deleteTransactionIfUnchanged("resource-intruder", inserted.id, before)).toBe(false);
      expect(await getTransaction("resource-owner", inserted.id)).not.toBeNull();
    });

    it("refuses expected and pot-funded rows", async () => {
      const expected = await seed("resource-guard", { status: "expected" });
      const potFunded = await seed("resource-guard", { fundedByPotId: "pot-1" });
      for (const id of [expected.id, potFunded.id]) {
        expect(await updateTransactionIfUnchanged("resource-guard", id, before, { amount: 1 })).toBe(false);
        expect(await deleteTransactionIfUnchanged("resource-guard", id, before)).toBe(false);
      }
    });

    it("deletes a row that still matches and refuses a stale delete", async () => {
      const inserted = await seed("resource-delete");
      expect(await deleteTransactionIfUnchanged("resource-delete", inserted.id, { ...before, merchant: "Uber" })).toBe(false);
      expect(await deleteTransactionIfUnchanged("resource-delete", inserted.id, before)).toBe(true);
      expect(await getTransaction("resource-delete", inserted.id)).toBeNull();
    });
  });
});
