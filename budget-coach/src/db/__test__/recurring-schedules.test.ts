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

const { listSchedules, addSchedule, deleteSchedule, findScheduleByMerchant } = await import(
  "../recurring-schedules"
);
const { addTransaction, listTransactions } = await import("../transactions");
const { dbClient } = await import("../client");

describe("recurring schedules", () => {
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

  it("returns an empty list for a resourceId with no schedules", async () => {
    const schedules = await listSchedules("resource-empty");
    expect(schedules).toHaveLength(0);
  });

  it("scopes schedules to their resourceId", async () => {
    await addSchedule({
      resourceId: "resource-a",
      merchant: "Salary",
      amount: 5000,
      type: "income",
      category: null,
      dayOfMonth: 1,
    });
    await addSchedule({
      resourceId: "resource-b",
      merchant: "Rent",
      amount: 1200,
      type: "expense",
      category: "Housing",
      dayOfMonth: 3,
    });

    const a = await listSchedules("resource-a");
    const b = await listSchedules("resource-b");

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a.every((s) => s.resourceId === "resource-a")).toBe(true);
    expect(b.every((s) => s.resourceId === "resource-b")).toBe(true);
  });

  it("findScheduleByMerchant matches case-insensitively and trims whitespace", async () => {
    await addSchedule({
      resourceId: "resource-find",
      merchant: "Netflix",
      amount: 15,
      type: "expense",
      category: "Entertainment",
      dayOfMonth: 10,
    });

    const found = await findScheduleByMerchant("resource-find", "  NETFLIX  ");
    expect(found?.merchant).toBe("Netflix");

    const notFound = await findScheduleByMerchant("resource-find", "Spotify");
    expect(notFound).toBeUndefined();
  });

  it("deleteSchedule removes the schedule and its expected transactions, but keeps received ones", async () => {
    const schedule = await addSchedule({
      resourceId: "resource-delete",
      merchant: "Gym",
      amount: 40,
      type: "expense",
      category: "Health",
      dayOfMonth: 5,
    });

    await addTransaction({
      resourceId: "resource-delete",
      date: "2026-02-05",
      merchant: "Gym",
      amount: 40,
      type: "expense",
      category: "Health",
      seedCategory: null,
      status: "expected",
      scheduleId: schedule.id,
    });
    await addTransaction({
      resourceId: "resource-delete",
      date: "2026-01-05",
      merchant: "Gym",
      amount: 40,
      type: "expense",
      category: "Health",
      seedCategory: null,
      status: "received",
      scheduleId: schedule.id,
    });

    const deleted = await deleteSchedule("resource-delete", schedule.id);
    expect(deleted).toBe(true);

    const schedules = await listSchedules("resource-delete");
    expect(schedules).toHaveLength(0);

    const transactions = await listTransactions("resource-delete");
    expect(transactions).toHaveLength(1);
    expect(transactions[0].status).toBe("received");
  });

  it("deleteSchedule returns false for a schedule that does not exist", async () => {
    const deleted = await deleteSchedule("resource-missing", "not-a-real-id");
    expect(deleted).toBe(false);
  });
});
