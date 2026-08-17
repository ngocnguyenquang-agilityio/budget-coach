import { describe, expect, it } from "vitest";
import {
  mastraToAGUIMessages,
  type MastraStoredMessage,
} from "./mastra-to-agui-messages";

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 7, 17, 0, 0, seconds)).toISOString();

const userMessage = (id: string, text: string, seconds: number): MastraStoredMessage => ({
  id,
  role: "user",
  createdAt: at(seconds),
  content: { parts: [{ type: "text", text }] },
});

describe("mastraToAGUIMessages", () => {
  it("converts a plain user/assistant exchange", () => {
    const result = mastraToAGUIMessages([
      userMessage("u1", "How much did I spend on Dining?", 1),
      {
        id: "a1",
        role: "assistant",
        createdAt: at(2),
        content: { parts: [{ type: "text", text: "You spent $236.70." }] },
      },
    ]);

    expect(result).toEqual([
      { id: "u1", role: "user", content: "How much did I spend on Dining?" },
      { id: "a1", role: "assistant", content: "You spent $236.70." },
    ]);
  });

  it("splits assistant text that follows a tool call onto the continuation id", () => {
    const result = mastraToAGUIMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: at(1),
        content: {
          parts: [
            { type: "text", text: "Let me check. " },
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "result",
                toolCallId: "call_1",
                toolName: "analyzeSpending",
                args: {},
                result: { trailingSpend: 3106.41 },
              },
            },
            { type: "step-start" },
            { type: "text", text: "You spent $236.70 on Dining." },
          ],
        },
      },
    ]);

    expect(result).toEqual([
      {
        id: "a1",
        role: "assistant",
        content: "Let me check. ",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "analyzeSpending", arguments: "{}" },
          },
        ],
      },
      {
        id: "call_1-result",
        role: "tool",
        toolCallId: "call_1",
        content: '{"trailingSpend":3106.41}',
      },
      {
        id: "a1-agui-text",
        role: "assistant",
        content: "You spent $236.70 on Dining.",
      },
    ]);
  });

  it("passes an already-stringified result through without double-encoding", () => {
    const result = mastraToAGUIMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: at(1),
        content: {
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "result",
                toolCallId: "call_1",
                toolName: "confirmCategory",
                args: { merchant: "Trader Joe's" },
                result: '{"decision":"approve"}',
              },
            },
          ],
        },
      },
    ]);

    expect(result[1]).toEqual({
      id: "call_1-result",
      role: "tool",
      toolCallId: "call_1",
      content: '{"decision":"approve"}',
    });
  });

  it("emits no tool message for a call still awaiting its result", () => {
    const result = mastraToAGUIMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: at(1),
        content: {
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "call",
                toolCallId: "call_1",
                toolName: "approveBudget",
                args: {},
              },
            },
          ],
        },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "a1", role: "assistant" });
    expect(result.some((message) => message.role === "tool")).toBe(false);
  });

  it("re-attaches an unattributed result to the call it answers", () => {
    // Real shape from this app: approveBudget persisted as a pending call, its
    // approval arriving later as a part whose toolName was lost.
    const result = mastraToAGUIMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: at(1),
        content: {
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "call",
                toolCallId: "call_609850",
                toolName: "approveBudget",
                args: {},
              },
            },
          ],
        },
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: at(2),
        content: {
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "result",
                toolCallId: "call_609850",
                toolName: "unknown",
                args: {},
                result: '{"decision":"approve"}',
              },
            },
          ],
        },
      },
    ]);

    expect(result).toEqual([
      {
        id: "a1",
        role: "assistant",
        toolCalls: [
          {
            id: "call_609850",
            type: "function",
            function: { name: "approveBudget", arguments: "{}" },
          },
        ],
      },
      {
        id: "call_609850-result",
        role: "tool",
        toolCallId: "call_609850",
        content: '{"decision":"approve"}',
      },
    ]);
  });

  it("skips an unattributed result with no call anywhere to answer", () => {
    const result = mastraToAGUIMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: at(1),
        content: {
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "result",
                toolCallId: "call_609850",
                toolName: "unknown",
                args: {},
                result: '{"decision":"approve"}',
              },
            },
            { type: "text", text: "Approved." },
          ],
        },
      },
    ]);

    // The unrenderable call is dropped, so its text stays on the original id
    // rather than being pushed onto a continuation message.
    expect(result).toEqual([
      { id: "a1", role: "assistant", content: "Approved." },
    ]);
  });

  it("orders by createdAt and skips system and signal roles", () => {
    const result = mastraToAGUIMessages([
      userMessage("u2", "second", 20),
      { id: "s1", role: "system", createdAt: at(1), content: { parts: [{ type: "text", text: "sys" }] } },
      userMessage("u1", "first", 10),
    ]);

    expect(result.map((message) => message.id)).toEqual(["u1", "u2"]);
  });

  it("drops assistant messages left with no content and no tool calls", () => {
    const result = mastraToAGUIMessages([
      {
        id: "a1",
        role: "assistant",
        createdAt: at(1),
        content: { parts: [{ type: "step-start" }, { type: "reasoning" }] },
      },
    ]);

    expect(result).toEqual([]);
  });
});
