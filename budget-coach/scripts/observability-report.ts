// Local telemetry report over the spans LibSQL persists. Answers the three
// questions this project's observability was set up for: which tools fail,
// which guardrails fire, and what's slow. See docs/adr/0008-span-only-observability.md.
//
// Usage: pnpm report:observability [days]
import "dotenv/config";
import { mastra } from "../src/mastra";
import { OBSERVABILITY_EVENTS } from "../src/constants/observability";

const days = Number(process.argv[2] ?? 7);
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

type SpanRow = {
  name?: string | null;
  entityName?: string | null;
  spanType?: string | null;
  metadata?: Record<string, unknown> | null;
  error?: unknown;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
};

const tally = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const printCounts = (title: string, counts: Map<string, number>) => {
  console.log(`\n${title}`);
  if (counts.size === 0) {
    console.log("  (none)");
    return;
  }
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }
};

const main = async () => {
  const storage = mastra.getStorage();
  const observability = await storage?.getStore("observability");
  if (!observability) throw new Error("Observability store unavailable");

  const toolFailures = new Map<string, number>();
  const guardrailBlocks = new Map<string, number>();
  const durationsByTool = new Map<string, number[]>();
  let traceCount = 0;
  let erroredTraces = 0;

  // listTraces returns root spans only, so each trace is fetched to walk its
  // children — the countable events live on child spans, not on the root.
  let page = 0;
  for (;;) {
    const { spans: roots, pagination } = await observability.listTraces({
      filters: { startedAt: { start: since } },
      pagination: { page, perPage: 100 },
    });
    if (roots.length === 0) break;

    for (const root of roots) {
      traceCount += 1;
      const trace = await observability.getTrace({ traceId: root.traceId });
      for (const span of (trace?.spans ?? []) as SpanRow[]) {
        const event = span.metadata?.event;

        if (event === OBSERVABILITY_EVENTS.toolFailure) {
          tally(toolFailures, String(span.metadata?.tool ?? span.entityName ?? span.name ?? "unknown"));
        }
        if (event === OBSERVABILITY_EVENTS.guardrailBlock) {
          tally(guardrailBlocks, String(span.metadata?.processorId ?? "unknown"));
        }
        if (span.spanType === "tool_call" && span.startedAt && span.endedAt) {
          const ms = new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime();
          // entityName is the bare tool name; `name` is wrapped as "tool: 'x'".
          const key = span.entityName ?? span.name ?? "unknown";
          durationsByTool.set(key, [...(durationsByTool.get(key) ?? []), ms]);
        }
      }
      if (root.error) erroredTraces += 1;
    }

    if (!pagination?.hasMore) break;
    page += 1;
  }

  console.log(`Observability report — last ${days} day(s), since ${since.toISOString()}`);
  console.log(`\n${traceCount} trace(s), ${erroredTraces} with a failed root span`);

  printCounts("Tool failures by tool", toolFailures);
  printCounts("Guardrail blocks by processor", guardrailBlocks);

  console.log("\nTool duration (ms)");
  if (durationsByTool.size === 0) {
    console.log("  (none)");
  } else {
    for (const [tool, values] of durationsByTool) {
      const sorted = [...values].sort((a, b) => a - b);
      console.log(
        `  ${tool}: n=${sorted.length} p50=${percentile(sorted, 50)} p95=${percentile(sorted, 95)} max=${sorted[sorted.length - 1]}`,
      );
    }
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
