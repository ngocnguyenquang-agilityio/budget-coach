
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBConnection, DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';

// DuckDB only allows a single write batch/compaction against an instance at a
// time (its C API has no concurrent-writer support), but DuckDBConnection
// opens a fresh connection per call with no serialization. Concurrent
// observability writes (e.g. span-start/span-end firing close together) then
// race and DuckDB throws "Another write batch or compaction is already
// active". Queue every call through the same connection so they run one at a
// time instead of racing.
function serializeDuckDbCalls() {
  let queue: Promise<unknown> = Promise.resolve();
  const proto = DuckDBConnection.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  (['query', 'execute', 'executeBatch'] as const).forEach((method) => {
    const original = proto[method];
    proto[method] = function (this: unknown, ...args: unknown[]) {
      const run = queue.then(() => original.apply(this, args));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
  });
}

async function createMastra() {
  serializeDuckDbCalls();

  return new Mastra({
    workflows: { weatherWorkflow },
    agents: { weatherAgent },
    storage: new MastraCompositeStore({
      id: 'composite-storage',
      default: new LibSQLStore({
        id: "mastra-storage",
        // Uses a hosted database when deployed (mastra env db create --kind turso),
        // and a local file during development.
        url: process.env.TURSO_DATABASE_URL ?? "file:./mastra.db",
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
      domains: {
        observability: await new DuckDBStore().getStore('observability'),
      }
    }),
    logger: new PinoLogger({
      name: 'Mastra',
      level: 'info',
    }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'mastra',
          exporters: [
            new MastraStorageExporter(), // Persists observability events to Mastra Storage
            new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
          ],
          spanOutputProcessors: [
            new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
          ],
        },
      },
    }),
  });
}

// Next.js dev (Fast Refresh) re-evaluates this module on every server-side
// recompile without tearing down the previous instance. Since DuckDBStore
// holds an exclusive file handle on mastra.duckdb (Windows locks files
// exclusively by default), re-running `new DuckDBStore()` on each reload
// tries to open a file the still-alive previous connection already has
// locked, throwing "Cannot open file mastra.duckdb: ... used by another
// process". Cache the instance across reloads so dev only opens it once.
declare global {
  var __mastra: ReturnType<typeof createMastra> | undefined;
}

export const mastra = await (globalThis.__mastra ??= createMastra());
