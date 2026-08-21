import type { MastraDBMessage } from "@mastra/core/memory";

// Text can live in `content.parts` (text parts) or fall back to
// `content.content`. Shared by the guardrail processors that need to read
// message text (src/mastra/processors/*.ts).
export const getMessageText = (message: MastraDBMessage): string => {
  let text = "";

  if (message.content.parts) {
    for (const part of message.content.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        text += part.text;
      }
    }
  }

  if (!text && typeof message.content.content === "string") {
    text = message.content.content;
  }

  return text;
};

// Scorer run output for an agent is the full MastraDBMessage[] response —
// joins every assistant message's text, since a tool-using turn (e.g. the
// Coach) can span several.
export const getAssistantText = (messages: unknown): string => {
  if (!Array.isArray(messages)) return "";

  return messages
    .filter((message): message is MastraDBMessage => message?.role === "assistant")
    .map(getMessageText)
    .join(" ");
};
