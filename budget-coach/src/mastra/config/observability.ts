import { Observability, MastraStorageExporter, SensitiveDataFilter } from "@mastra/observability";
import { ModelCostEstimator } from "@/mastra/processors/model-cost-estimator";

// Writes spans to the same file-backed LibSQL store as `storage`, so traces
// for every agent/tool call show up in Mastra Studio with no extra infra.
export const observability = new Observability({
  configs: {
    default: {
      serviceName: "budget-coach",
      exporters: [new MastraStorageExporter()],
      spanOutputProcessors: [new ModelCostEstimator(), new SensitiveDataFilter()],
      // LibSQL's observability domain stores spans only — no log table — so this
      // dual-write is dropped by the exporter and Studio's Logs tab stays empty.
      // Kept so logs appear if the store ever gains an OLAP backend (see ADR-0008).
      logging: {
        enabled: true,
        level: "info",
      },
    },
  },
});
