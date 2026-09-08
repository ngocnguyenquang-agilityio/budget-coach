import { dbClient } from "./client";
import type { Category } from "@/domain/categories";

// A Recurring Schedule is a repeating money movement the user maintains — a
// salary, rent, a utility bill. It generates one `expected` Transaction per
// Period (ADR-0011) and holds no money itself.
//
// Lives in LibSQL rather than working memory: unlike the handful of resource-
// scoped values in BudgetState, schedules are list-shaped and read on every
// transaction query, right beside the rows they generate.
export interface RecurringSchedule {
  id: string;
  resourceId: string;
  merchant: string;
  amount: number;
  type: "income" | "expense";
  category: Category | null;
  // 1–31, clamped to the month's length when a Period is materialized.
  dayOfMonth: number;
  createdAt: string;
}

const COLUMNS = "id, resourceId, merchant, amount, type, category, dayOfMonth, createdAt";

let ensured: Promise<void> | null = null;

export async function createTable(): Promise<void> {
  ensured ??= dbClient
    .execute(`
      CREATE TABLE IF NOT EXISTS recurring_schedules (
        id TEXT PRIMARY KEY,
        resourceId TEXT NOT NULL,
        merchant TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        category TEXT,
        dayOfMonth INTEGER NOT NULL,
        createdAt TEXT NOT NULL
      )
    `)
    .then(() => undefined);

  await ensured;
}

const toSchedule = (row: Record<string, unknown>): RecurringSchedule => ({
  id: row.id as string,
  resourceId: row.resourceId as string,
  merchant: row.merchant as string,
  amount: row.amount as number,
  type: row.type as "income" | "expense",
  category: (row.category as Category | null) ?? null,
  dayOfMonth: Number(row.dayOfMonth),
  createdAt: row.createdAt as string,
});

export async function listSchedules(resourceId: string): Promise<RecurringSchedule[]> {
  await createTable();

  const result = await dbClient.execute({
    sql: `SELECT ${COLUMNS} FROM recurring_schedules WHERE resourceId = ? ORDER BY createdAt ASC`,
    args: [resourceId],
  });

  return result.rows.map((row) => toSchedule(row as unknown as Record<string, unknown>));
}

export async function addSchedule(
  schedule: Omit<RecurringSchedule, "id" | "createdAt"> & { id?: string; createdAt?: string }
): Promise<RecurringSchedule> {
  await createTable();

  const id = schedule.id ?? crypto.randomUUID();
  const createdAt = schedule.createdAt ?? new Date().toISOString();

  await dbClient.execute({
    sql: `INSERT INTO recurring_schedules (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      schedule.resourceId,
      schedule.merchant,
      schedule.amount,
      schedule.type,
      schedule.category,
      schedule.dayOfMonth,
      createdAt,
    ],
  });

  return { ...schedule, id, createdAt };
}

// Deletes the schedule and any Transaction it generated that is still
// `expected` — a forecast whose rule is gone should not survive it. Rows the
// user already confirmed are real money and are left alone.
export async function deleteSchedule(resourceId: string, id: string): Promise<boolean> {
  await createTable();

  const result = await dbClient.execute({
    sql: "DELETE FROM recurring_schedules WHERE resourceId = ? AND id = ?",
    args: [resourceId, id],
  });

  if (Number(result.rowsAffected ?? 0) === 0) return false;

  await dbClient.execute({
    sql: "DELETE FROM transactions WHERE resourceId = ? AND scheduleId = ? AND status = 'expected'",
    args: [resourceId, id],
  });

  return true;
}

export async function findScheduleByMerchant(
  resourceId: string,
  merchant: string
): Promise<RecurringSchedule | undefined> {
  const schedules = await listSchedules(resourceId);
  return schedules.find((schedule) => schedule.merchant.toLowerCase() === merchant.trim().toLowerCase());
}
