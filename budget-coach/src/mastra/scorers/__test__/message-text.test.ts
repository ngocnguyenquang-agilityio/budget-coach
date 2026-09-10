import { describe, expect, it } from "vitest";
import type { MastraDBMessage } from "@mastra/core/memory";
import { getAssistantText, getMessageText } from "../message-text";

const messageWithParts = (parts: Array<{ type: string; text?: string }>): MastraDBMessage => {
  return { role: "assistant", content: { parts } } as unknown as MastraDBMessage;
};

const messageWithContent = (content: string): MastraDBMessage => {
  return { role: "assistant", content: { content } } as unknown as MastraDBMessage;
};

describe("getMessageText", () => {
  it("joins text parts from content.parts", () => {
    const message = messageWithParts([
      { type: "text", text: "Hello, " },
      { type: "text", text: "world." },
    ]);

    expect(getMessageText(message)).toBe("Hello, world.");
  });

  it("skips non-text parts", () => {
    const message = messageWithParts([
      { type: "tool-invocation" },
      { type: "text", text: "Result is ready." },
    ]);

    expect(getMessageText(message)).toBe("Result is ready.");
  });

  it("falls back to content.content when there are no text parts", () => {
    const message = messageWithContent("Fallback text.");

    expect(getMessageText(message)).toBe("Fallback text.");
  });

  it("prefers parts text over content.content when both are present", () => {
    const message = {
      role: "assistant",
      content: { parts: [{ type: "text", text: "From parts." }], content: "From content." },
    } as unknown as MastraDBMessage;

    expect(getMessageText(message)).toBe("From parts.");
  });

  it("returns an empty string when there is no text anywhere", () => {
    const message = messageWithParts([{ type: "tool-invocation" }]);

    expect(getMessageText(message)).toBe("");
  });
});

describe("getAssistantText", () => {
  it("joins text from every assistant message, skipping other roles", () => {
    const messages = [
      messageWithContent("First."),
      { role: "user", content: { content: "Ignore me." } } as unknown as MastraDBMessage,
      messageWithContent("Second."),
    ];

    expect(getAssistantText(messages)).toBe("First. Second.");
  });

  it("returns an empty string when input is not an array", () => {
    expect(getAssistantText(undefined)).toBe("");
    expect(getAssistantText("not an array")).toBe("");
  });

  it("returns an empty string when there are no assistant messages", () => {
    const messages = [{ role: "user", content: { content: "Hi." } } as unknown as MastraDBMessage];

    expect(getAssistantText(messages)).toBe("");
  });
});
