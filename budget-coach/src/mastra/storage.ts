import { LibSQLStore } from "@mastra/libsql";

// Must be persistent, not in-memory: an in-memory DB breaks suspend/resume
// (the Monthly Review approval gate) because pooled connections each see an
// empty DB. Locally this is the file:./budget-coach.db SQLite file; in
// production it's a remote Turso database via TURSO_DATABASE_URL/
// TURSO_AUTH_TOKEN. Same URL src/db/client.ts points at, so Mastra tables and
// the transactions table live together.
export const storage = new LibSQLStore({
  id: "budget-coach-storage",
  url: process.env.TURSO_DATABASE_URL ?? "file:./budget-coach.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
