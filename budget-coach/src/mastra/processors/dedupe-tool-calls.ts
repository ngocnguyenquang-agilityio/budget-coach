import type { Processor, ProcessInputArgs } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

// @ag-ui/mastra can hand Mastra the same tool call twice (once re-attached from
// its own diffing, once via Mastra's memory recall), which the model rejects
// as "Multiple tool calls with the same id". Drop the duplicate, keeping
// whichever copy has a result over a bare pending call.
const STATE_RANK: Record<string, number> = { "partial-call": 0, call: 1, result: 2 };

type ToolInvocationPart = Extract<
  NonNullable<MastraDBMessage["content"]["parts"]>[number],
  { type: "tool-invocation" }
>;

export class DedupeToolCallsProcessor implements Processor {
  readonly id = "dedupe-tool-calls";

  processInput({ messages }: ProcessInputArgs): MastraDBMessage[] {
    const bestPartForId = new Map<string, ToolInvocationPart>();

    for (const message of messages) {
      for (const part of message.content.parts ?? []) {
        if (part.type !== "tool-invocation") continue;
        const toolCallId = part.toolInvocation?.toolCallId;
        if (!toolCallId) continue;

        const current = bestPartForId.get(toolCallId);
        const rank = STATE_RANK[part.toolInvocation.state ?? ""] ?? 0;
        if (!current || rank > (STATE_RANK[current.toolInvocation.state ?? ""] ?? 0)) {
          bestPartForId.set(toolCallId, part);
        }
      }
    }

    return messages.map((message) => {
      const parts = message.content.parts;
      if (message.role !== "assistant" || !parts) return message;

      let changed = false;
      const dedupedParts = parts.filter((part) => {
        if (part.type !== "tool-invocation") return true;
        const toolCallId = part.toolInvocation?.toolCallId;
        if (!toolCallId) return true;

        if (bestPartForId.get(toolCallId) !== part) {
          changed = true;
          return false;
        }
        return true;
      });

      if (!changed) return message;
      return { ...message, content: { ...message.content, parts: dedupedParts } };
    });
  }
}
