import { describe, expect, it } from "vitest";
import type { MastraDBMessage } from "@mastra/core/memory";
import { DedupeToolCallsProcessor } from "../dedupe-tool-calls";

const assistantMessage = (
  parts: Array<{ toolCallId: string; state: "partial-call" | "call" | "result" }>
): MastraDBMessage => {
  return {
    role: "assistant",
    content: {
      parts: parts.map(({ toolCallId, state }) => ({
        type: "tool-invocation",
        toolInvocation: { toolCallId, state },
      })),
    },
  } as unknown as MastraDBMessage;
};

describe("DedupeToolCallsProcessor", () => {
  it("keeps only the highest-ranked copy of a duplicated tool call across messages", () => {
    const processor = new DedupeToolCallsProcessor();
    const messages = [
      assistantMessage([{ toolCallId: "call-1", state: "call" }]),
      assistantMessage([{ toolCallId: "call-1", state: "result" }]),
    ];

    const result = processor.processInput({ messages } as any);

    expect(result[0].content.parts).toEqual([]);
    expect(result[1].content.parts).toEqual([
      { type: "tool-invocation", toolInvocation: { toolCallId: "call-1", state: "result" } },
    ]);
  });

  it("prefers a result over a bare pending call within the same message", () => {
    const processor = new DedupeToolCallsProcessor();
    const messages = [
      assistantMessage([
        { toolCallId: "call-1", state: "partial-call" },
        { toolCallId: "call-1", state: "result" },
      ]),
    ];

    const result = processor.processInput({ messages } as any);

    expect(result[0].content.parts).toEqual([
      { type: "tool-invocation", toolInvocation: { toolCallId: "call-1", state: "result" } },
    ]);
  });

  it("leaves non-assistant messages and messages without duplicates unchanged", () => {
    const processor = new DedupeToolCallsProcessor();
    const userMessage = { role: "user", content: { content: "hi" } } as unknown as MastraDBMessage;
    const singleCall = assistantMessage([{ toolCallId: "call-1", state: "call" }]);
    const messages = [userMessage, singleCall];

    const result = processor.processInput({ messages } as any);

    expect(result[0]).toBe(userMessage);
    expect(result[1]).toBe(singleCall);
  });

  it("ignores parts without a toolCallId and leaves other part types untouched", () => {
    const processor = new DedupeToolCallsProcessor();
    const message = {
      role: "assistant",
      content: {
        parts: [
          { type: "text", text: "hello" },
          { type: "tool-invocation", toolInvocation: { state: "call" } },
        ],
      },
    } as unknown as MastraDBMessage;

    const result = processor.processInput({ messages: [message] } as any);

    expect(result[0]).toBe(message);
  });
});
