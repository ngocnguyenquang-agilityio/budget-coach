import { describe, expect, it, vi } from "vitest";
import type { MastraDBMessage } from "@mastra/core/memory";
import { FinancialAdviceGuardrail } from "./financial-advice-guardrail";
import { guardrailBlockChannel } from "../guardrails/block-channel";

const userMessage = (text: string): MastraDBMessage => {
  return {
    role: "user",
    content: { content: text },
  } as unknown as MastraDBMessage;
};

const guardrail = () =>
  new FinancialAdviceGuardrail({
    instrumentKeywords: ["stock", "stocks", "crypto", "fund"],
    decisionKeywords: ["should", "buy", "recommend"],
  });

describe("FinancialAdviceGuardrail", () => {
  it("blocks when the message contains an instrument word AND a decision word, even without a fixed phrase match", () => {
    const abort = vi.fn();

    guardrail().processInput({
      messages: [userMessage("Should I buy Nvidia stock?")],
      abort,
    } as any);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith(
      "Message blocked: financial-advice request",
      expect.objectContaining({ metadata: { matchedInstrument: "stock", matchedDecision: "should" } })
    );
  });

  it("does not block when only an instrument word is present", () => {
    const abort = vi.fn();

    guardrail().processInput({
      messages: [userMessage("I spent $40 on a bond fund transfer fee")],
      abort,
    } as any);

    expect(abort).not.toHaveBeenCalled();
  });

  it("does not block when only a decision word is present", () => {
    const abort = vi.fn();

    guardrail().processInput({
      messages: [userMessage("Should I set a grocery limit?")],
      abort,
    } as any);

    expect(abort).not.toHaveBeenCalled();
  });

  // ADR-0008: "fund" was narrowed to its investment-only phrases so budgeting
  // vocabulary ("emergency fund", "fund my trip") and the substring "refund"
  // no longer false-trip alongside a decision word.
  it("does not block budgeting uses of 'fund' or the substring 'refund'", () => {
    const abort = vi.fn();
    const g = new FinancialAdviceGuardrail({
      instrumentKeywords: ["stock", "mutual fund", "index fund", "hedge fund"],
      decisionKeywords: ["should", "buy", "recommend"],
    });

    g.processInput({ messages: [userMessage("Should I get a refund on that?")], abort } as any);
    g.processInput({ messages: [userMessage("Help me fund my emergency savings")], abort } as any);

    expect(abort).not.toHaveBeenCalled();
  });

  it("still blocks an investment fund phrase with a decision word", () => {
    const abort = vi.fn();
    const g = new FinancialAdviceGuardrail({
      instrumentKeywords: ["stock", "mutual fund", "index fund", "hedge fund"],
      decisionKeywords: ["should", "buy", "recommend"],
    });

    g.processInput({ messages: [userMessage("Should I buy an index fund?")], abort } as any);

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("only checks the latest user message, not earlier resent history", () => {
    const abort = vi.fn();

    guardrail().processInput({
      messages: [
        userMessage("should I buy crypto"),
        { role: "assistant", content: { content: "I can't help with that." } } as unknown as MastraDBMessage,
        userMessage("What's my dining spend this month?"),
      ],
      abort,
    } as any);

    expect(abort).not.toHaveBeenCalled();
  });

  it("records the configured userMessage on the guardrail-block channel via processInput (the actual execution path - Mastra's workflow-step processor pipeline never calls onViolation)", () => {
    const abort = vi.fn();
    const g = new FinancialAdviceGuardrail({
      instrumentKeywords: ["stock", "stocks", "crypto", "fund"],
      decisionKeywords: ["should", "buy", "recommend"],
      userMessage: "I can only help with budgeting, not investment advice.",
    });

    const store = guardrailBlockChannel.run({ sawAssistantText: false }, () => {
      g.processInput({
        messages: [userMessage("Should I buy Nvidia stock?")],
        abort,
      } as any);
      return guardrailBlockChannel.getStore();
    });

    expect(store?.userMessage).toBe("I can only help with budgeting, not investment advice.");
  });
});
