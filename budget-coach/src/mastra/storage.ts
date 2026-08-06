import { LibSQLStore } from "@mastra/libsql";

// Must be file-backed, not in-memory: an in-memory DB breaks suspend/resume
// (Day 3's Monthly Review approval gate) because pooled connections each see
// an empty DB. Same file src/db/client.ts points at, so Mastra tables and the
// transactions table live together.
export const storage = new LibSQLStore({
  id: "budget-coach-storage",
  url: process.env.TURSO_DATABASE_URL ?? "file:./budget-coach.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
