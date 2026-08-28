import { Observability, MastraStorageExporter, SensitiveDataFilter } from "@mastra/observability";

// Writes spans to the same file-backed LibSQL store as `storage`, so traces
// for every agent/tool call show up in Mastra Studio with no extra infra.
export const observability = new Observability({
  configs: {
    default: {
      serviceName: "budget-coach",
      exporters: [new MastraStorageExporter()],
      spanOutputProcessors: [new SensitiveDataFilter()],
      logging: {
        enabled: true,
        level: "info",
      },
    },
  },
});
