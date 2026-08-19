import { describe, expect, it } from "vitest";
import type { MastraDBMessage } from "@mastra/core/memory";
import { categorizerAccuracyScorer } from "./categorizer-accuracy";
import { EMPTY_SCORER_INPUT } from "@/constants/scorer-inputs";

const assistantMessage = (text: string): MastraDBMessage => {
  return {
    id: "1",
    role: "assistant",
    createdAt: new Date(),
    content: { format: 2, parts: [{ type: "text", text }] },
  } as unknown as MastraDBMessage;
};

describe("categorizerAccuracyScorer", () => {
  it("scores 1 when the assigned category matches seed ground truth", async () => {
    const result = await categorizerAccuracyScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [assistantMessage('{"category":"Groceries"}')],
      groundTruth: "Groceries",
    });

    expect(result.score).toBe(1);
  });

  it("scores 0 when the assigned category doesn't match seed ground truth", async () => {
    const result = await categorizerAccuracyScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [assistantMessage('{"category":"Dining"}')],
      groundTruth: "Groceries",
    });

    expect(result.score).toBe(0);
  });

  it("scores 1 when there is no ground truth to check against", async () => {
    const result = await categorizerAccuracyScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [assistantMessage('{"category":"Shopping"}')],
    });

    expect(result.score).toBe(1);
  });

  it("scores 1 when the assigned type matches income ground truth", async () => {
    const result = await categorizerAccuracyScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [assistantMessage('{"type":"income"}')],
      groundTruth: "Income",
    });

    expect(result.score).toBe(1);
  });

  it("scores 0 when an expense is assigned but income was expected", async () => {
    const result = await categorizerAccuracyScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [assistantMessage('{"type":"expense","category":"Shopping"}')],
      groundTruth: "Income",
    });

    expect(result.score).toBe(0);
  });
});
