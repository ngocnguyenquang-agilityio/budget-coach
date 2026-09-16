import { describe, expect, it } from "vitest";
import type { MastraDBMessage } from "@mastra/core/memory";
import { WorkingMemoryLeakGuardrail } from "../working-memory-leak-guardrail";
import { WORKING_MEMORY_LEAK_MARKERS } from "@/constants/guardrail-phrases";

const assistantMessage = (text: string): MastraDBMessage => {
  return {
    role: "assistant",
    content: { parts: [{ type: "text", text }], content: text },
  } as unknown as MastraDBMessage;
};

// Shape observed in production: the model pastes the raw working-memory
// blob mid-sentence, then self-corrects into the real answer.
const LEAKED_BLOB =
  '{"categoryLimits":{"Shopping":405,"Transport":135,"Dining":540,"Utilities":135,"Entertainment":270,"Groceries":135,"Housing":540,"Health":270,"Other":270},"savingsPots":[{"id":"88b26436-2f88-4c65-b03a-e350ee90e530","kind":"target","name":"Macbook","targetAmount":2000,"balance":50}],"lastReviewPeriod":"2026-08","lastClosedPeriod":"2026-08","unallocated":200,"coachPreferences":{"verbosity":"concise","nickname":"Quang","emphasizedCategories":[]},"pendingAmendments":[{"period":"2026-08","netSavingsAtClose":-127}],"pendingApproval":null}';

describe("WorkingMemoryLeakGuardrail", () => {
  it("redacts a leaked working-memory blob while keeping the surrounding reply", () => {
    const guardrail = new WorkingMemoryLeakGuardrail(WORKING_MEMORY_LEAK_MARKERS);
    const text = `Your Netflix charge $15.99 has been confirmed. Let me ...${LEAKED_BLOB}Your Netflix charge of $15.99 has been confirmed and logged as an Entertainment expense for September.`;

    const result = guardrail.processOutputResult({
      messages: [assistantMessage(text)],
    } as any) as MastraDBMessage[];

    const cleanedText = (result[0].content as any).parts[0].text;
    expect(cleanedText).not.toContain("categoryLimits");
    expect(cleanedText).not.toContain("savingsPots");
    expect(cleanedText).toContain("Your Netflix charge of $15.99 has been confirmed and logged");
  });

  it("leaves a clean reply untouched", () => {
    const guardrail = new WorkingMemoryLeakGuardrail(WORKING_MEMORY_LEAK_MARKERS);
    const text = "Your Netflix charge of $15.99 has been confirmed and logged as an Entertainment expense.";

    const result = guardrail.processOutputResult({
      messages: [assistantMessage(text)],
    } as any) as MastraDBMessage[];

    expect(result[0]).toEqual(
      expect.objectContaining({ content: expect.objectContaining({ content: text }) })
    );
  });

  it("does not redact an unrelated small JSON snippet (fewer than the marker threshold)", () => {
    const guardrail = new WorkingMemoryLeakGuardrail(WORKING_MEMORY_LEAK_MARKERS);
    const text = 'Sure — here is the raw filter I used: {"category":"Entertainment","month":"2026-09"}';

    const result = guardrail.processOutputResult({
      messages: [assistantMessage(text)],
    } as any) as MastraDBMessage[];

    expect((result[0].content as any).parts[0].text).toBe(text);
  });

  it("only touches the text part that actually contains the leak, in whichever message it appears", () => {
    const guardrail = new WorkingMemoryLeakGuardrail(WORKING_MEMORY_LEAK_MARKERS);
    const earlierStep = assistantMessage(`Here you go: ${LEAKED_BLOB}`);
    const finalStep = assistantMessage("All set — anything else?");

    const result = guardrail.processOutputResult({
      messages: [earlierStep, finalStep],
    } as any) as MastraDBMessage[];

    expect((result[0].content as any).parts[0].text).not.toContain("categoryLimits");
    expect((result[1].content as any).parts[0].text).toBe("All set — anything else?");
  });
});
