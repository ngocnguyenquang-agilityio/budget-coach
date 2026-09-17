import { describe, expect, it } from "vitest";
import { redactWorkingMemoryLeak } from "../redact-working-memory-leak";
import { WORKING_MEMORY_LEAK_MARKERS } from "@/constants/guardrail-phrases";

const redact = (text: string) => redactWorkingMemoryLeak(text, WORKING_MEMORY_LEAK_MARKERS);

const BLOB =
  '{ "categoryLimits":{}, "lastReviewPeriod":"", "lastClosedPeriod":"", "unallocated":0, "pendingApproval":null, "coachPreferences": {"verbosity":"","nickname":"","emphasizedCategories":[]}, "savingsPots":[], "pendingAmendments":[], "recurringSchedules": [{"merchant":"Rent","amount":1200}] }';

describe("redactWorkingMemoryLeak", () => {
  it("removes both blobs when the reply pastes the leak twice", () => {
    // The production shape (see the reported screenshot): a hallucinated
    // updateWorkingMemory 'plan' with the blob, then the blob again before the
    // real answer.
    const text = `Let's construct:\n\n${BLOB}\n\nCall updateWorkingMemory.\n\n${BLOB}Your rent payment of $1,200 on the 1st has been set up as a recurring expense.`;

    const { text: cleaned, redactedLength } = redact(text);

    expect(redactedLength).toBeGreaterThan(0);
    expect(cleaned).not.toContain("categoryLimits");
    expect(cleaned).not.toContain("pendingAmendments");
    expect(cleaned).not.toContain("updateWorkingMemory");
    expect(cleaned).toContain("Your rent payment of $1,200 on the 1st has been set up as a recurring expense.");
  });

  it("strips the working-memory ritual boilerplate lines", () => {
    const text = `guidelines: "Do not remove empty sections - you must include the empty sections".\n${BLOB}\nAll set!`;

    const { text: cleaned } = redact(text);

    expect(cleaned).not.toContain("Do not remove empty sections");
    expect(cleaned).not.toContain("savingsPots");
    expect(cleaned).toContain("All set!");
  });

  it("leaves a clean reply untouched", () => {
    const text = "Your Netflix charge of $15.99 has been confirmed and logged as an Entertainment expense.";

    const result = redact(text);

    expect(result).toEqual({ text, redactedLength: 0 });
  });

  it("does not redact a small JSON snippet below the marker threshold", () => {
    const text = 'Here is the filter I used: {"category":"Entertainment","month":"2026-09"}';

    const result = redact(text);

    expect(result).toEqual({ text, redactedLength: 0 });
  });
});
