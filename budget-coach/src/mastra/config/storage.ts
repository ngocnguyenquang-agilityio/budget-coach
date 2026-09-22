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

// @mastra/libsql's observability domain implements only span/trace methods.
// Everything else falls through to the base class, which throws "This storage
// provider does not support ..." — and Studio polls two of those on every
// Traces page load (`GET /observability/discovery/*` for the filter dropdowns,
// `GET /observability/feedback` for the feedback panel), so the dev server logs
// a stack trace as "Error calling handler" each time. Traces themselves are
// unaffected. Stub those read paths with the empty shapes their response
// schemas describe, silencing the errors until @mastra/libsql implements them
// upstream. The handler resolves this domain via `getStore("observability")`,
// which returns this very instance, so patching it is enough.
const observability = (storage as unknown as { stores?: Record<string, unknown> })
  .stores?.observability as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;

if (observability) {
  const emptyReads: Record<string, () => Promise<unknown>> = {
    getEntityNames: async () => ({ names: [] }),
    getEntityTypes: async () => ({ entityTypes: [] }),
    getServiceNames: async () => ({ serviceNames: [] }),
    getEnvironments: async () => ({ environments: [] }),
    getTags: async () => ({ tags: [] }),
    getMetricNames: async () => ({ names: [] }),
    getMetricLabelKeys: async () => ({ keys: [] }),
    getMetricLabelValues: async () => ({ values: [] }),
    listFeedback: async () => ({
      feedback: [],
      pagination: { total: 0, page: 0, perPage: false, hasMore: false },
    }),
  };
  for (const [name, impl] of Object.entries(emptyReads)) {
    observability[name] = impl;
  }
}
