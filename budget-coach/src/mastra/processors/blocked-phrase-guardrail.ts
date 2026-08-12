import type { Processor, ProcessInputArgs, ProcessInputResult } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

const getMessageText = (message: MastraDBMessage): string => {
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

export class BlockedPhraseGuardrail implements Processor {
  readonly id = "blocked-phrase-guardrail";
  private readonly blockedPhrases: string[];

  constructor({ blockedPhrases }: { blockedPhrases: string[] }) {
    this.blockedPhrases = blockedPhrases;
  }

  processInput({ messages, abort }: ProcessInputArgs): ProcessInputResult {
    // `messages` can include earlier turns from this thread (the chat
    // transport resends full history on every call). Only the latest user
    // message is this turn's actual input - checking older ones would keep
    // re-blocking on a past message forever, including ones that were
    // already blocked.
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const text = latestUserMessage ? getMessageText(latestUserMessage).toLowerCase() : "";

    for (const phrase of this.blockedPhrases) {
      if (text.includes(phrase.toLowerCase())) {
        abort("Message blocked: contains disallowed content", {
          retry: false,
          metadata: { phrase },
        });
      }
    }

    return messages;
  }
}
