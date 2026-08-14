import { createClient } from "@libsql/client";

// Points at the same URL as src/mastra/storage.ts's LibSQLStore — a separate
// client, not a separate database. Locally that's file:./budget-coach.db; in
// production it's a remote Turso database via TURSO_DATABASE_URL/
// TURSO_AUTH_TOKEN. Must stay persistent (not ":memory:") either way, since
// suspend/resume relies on every pooled connection seeing the same data.
export const dbClient = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./budget-coach.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
