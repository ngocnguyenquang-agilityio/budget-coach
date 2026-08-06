import { createClient } from "@libsql/client";

// Points at the same file:./budget-coach.db the Mastra LibSQLStore will use
// once Step 2 switches it off ":memory:" — a separate table, not a separate
// file. This client only needs its own file to exist and be file-backed.
export const dbClient = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./budget-coach.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
