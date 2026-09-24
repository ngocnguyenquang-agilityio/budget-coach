import { SpanType, type ModelGenerationAttributes, type SpanOutputProcessor } from "@mastra/core/observability";
import { MODEL_PRICING } from "@/constants/observability";

// Mastra Studio's own "Estimated cost" column needs a storage backend that
// implements its metrics domain — @mastra/libsql doesn't, so that column
// stays disabled here. `costContext` on the span's own attributes isn't
// gated by that, so we compute it ourselves and attach it there instead;
// it shows up in the span's attribute panel in Studio.
export class ModelCostEstimator implements SpanOutputProcessor {
  readonly name = "model-cost-estimator";

  process(span?: Parameters<SpanOutputProcessor["process"]>[0]) {
    if (span?.type === SpanType.MODEL_GENERATION) {
      const attributes = span.attributes as ModelGenerationAttributes | undefined;
      if (attributes?.usage) {
        const { inputTokens = 0, outputTokens = 0 } = attributes.usage;
        attributes.costContext = {
          provider: "anthropic",
          model: attributes.model,
          estimatedCost:
            inputTokens * MODEL_PRICING.inputCostPerToken +
            outputTokens * MODEL_PRICING.outputCostPerToken,
          costUnit: "USD",
        };
      }
    }
    return span;
  }

  async shutdown() {}
}
