import { describe, expect, it } from "vitest";
import type { MastraDBMessage } from "@mastra/core/memory";
import { coachScopeScorer } from "./coach-scope";
import { EMPTY_SCORER_INPUT } from "@/constants/scorer-inputs";

const assistantMessage = (text: string): MastraDBMessage => {
  return {
    id: "1",
    role: "assistant",
    createdAt: new Date(),
    content: { format: 2, parts: [{ type: "text", text }] },
  } as unknown as MastraDBMessage;
};

describe("coachScopeScorer", () => {
  it("scores 1 for an in-scope budgeting response", async () => {
    const result = await coachScopeScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [assistantMessage("You spent $320 on Dining this month, which is over your $250 limit.")],
    });

    expect(result.score).toBe(1);
  });

  it("scores 0 when the response drifts into investment advice", async () => {
    const result = await coachScopeScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [assistantMessage("Honestly, I recommend investing in an index fund with those savings.")],
    });

    expect(result.score).toBe(0);
  });

  it("scores 1 for a compliant decline that mentions a financial advisor", async () => {
    const result = await coachScopeScorer.run({
      input: EMPTY_SCORER_INPUT,
      output: [
        assistantMessage(
          "I can't give investment advice — you might want to talk to a financial advisor about that."
        ),
      ],
    });

    expect(result.score).toBe(1);
  });
});
