import { describe, expect, it } from "vitest";
import type { MastraDBMessage } from "@mastra/core/memory";
import { RegulatedAdviceOutputGuardrail } from "./regulated-advice-output-guardrail";

const assistantMessage = (text: string): MastraDBMessage => {
  return {
    role: "assistant",
    content: { format: 2, parts: [{ type: "text", text }] },
  } as unknown as MastraDBMessage;
};

const guardrail = () =>
  new RegulatedAdviceOutputGuardrail({
    blockedKeywords: ["index fund", "you should invest"],
    redirectMessage: "I can't help with investment advice — I can help you budget for it, though.",
  });

describe("RegulatedAdviceOutputGuardrail", () => {
  it("rewrites the last assistant message's text to the redirect when the response drifts into regulated-advice territory", () => {
    const messages = [assistantMessage("You should consider an index fund for retirement.")];

    const result = guardrail().processOutputResult({
      messages,
      result: { text: "You should consider an index fund for retirement." },
    } as any) as MastraDBMessage[];

    expect(result[0].content.parts).toEqual([
      { type: "text", text: "I can't help with investment advice — I can help you budget for it, though." },
    ]);
    expect(result[0].content.content).toBe(
      "I can't help with investment advice — I can help you budget for it, though."
    );
  });

  it("passes messages through unchanged when the response stays in budgeting scope", () => {
    const messages = [assistantMessage("You spent $340 on Dining this month, $40 over your limit.")];

    const result = guardrail().processOutputResult({
      messages,
      result: { text: "You spent $340 on Dining this month, $40 over your limit." },
    } as any);

    expect(result).toBe(messages);
  });
});
