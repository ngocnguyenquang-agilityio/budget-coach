import { describe, expect, it } from "vitest";
import { SpanType } from "@mastra/core/observability";
import { MODEL_PRICING } from "@/constants/observability";
import { ModelCostEstimator } from "../model-cost-estimator";

describe("ModelCostEstimator", () => {
  it("attaches an estimated cost to a model-generation span's attributes", () => {
    const estimator = new ModelCostEstimator();
    const span = {
      type: SpanType.MODEL_GENERATION,
      attributes: { model: "llama-3.3-70b", usage: { inputTokens: 1000, outputTokens: 500 } },
    };

    const result = estimator.process(span as any);

    expect((result as any)?.attributes.costContext).toEqual({
      provider: "anthropic",
      model: "llama-3.3-70b",
      estimatedCost: 1000 * MODEL_PRICING.inputCostPerToken + 500 * MODEL_PRICING.outputCostPerToken,
      costUnit: "USD",
    });
  });

  it("treats missing token counts as zero", () => {
    const estimator = new ModelCostEstimator();
    const span = {
      type: SpanType.MODEL_GENERATION,
      attributes: { model: "llama-3.3-70b", usage: {} },
    };

    const result = estimator.process(span as any);

    expect((result as any)?.attributes.costContext).toEqual({
      provider: "anthropic",
      model: "llama-3.3-70b",
      estimatedCost: 0,
      costUnit: "USD",
    });
  });

  it("leaves non model-generation spans untouched", () => {
    const estimator = new ModelCostEstimator();
    const span = { type: SpanType.AGENT_RUN, attributes: {} };

    const result = estimator.process(span as any);

    expect(result).toBe(span);
    expect((result as any).attributes.costContext).toBeUndefined();
  });

  it("does nothing when usage is missing from a model-generation span", () => {
    const estimator = new ModelCostEstimator();
    const span = { type: SpanType.MODEL_GENERATION, attributes: { model: "llama-3.3-70b" } };

    const result = estimator.process(span as any);

    expect((result as any)?.attributes.costContext).toBeUndefined();
  });

  it("returns undefined when called without a span", () => {
    const estimator = new ModelCostEstimator();

    expect(estimator.process(undefined)).toBeUndefined();
  });
});
