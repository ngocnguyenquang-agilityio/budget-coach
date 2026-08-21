import type { Processor, ProcessInputArgs, ProcessInputResult, ProcessorViolation } from "@mastra/core/processors";
import { recordGuardrailViolation } from "../guardrail-block-channel";
import { getMessageText } from "../scorers/message-text";

export class BlockedPhraseGuardrail implements Processor {
  readonly id = "blocked-phrase-guardrail";
  private readonly blockedPhrases: string[];
  private readonly userMessage?: string;

  constructor({ blockedPhrases, userMessage }: { blockedPhrases: string[]; userMessage?: string }) {
    this.blockedPhrases = blockedPhrases;
    this.userMessage = userMessage;
  }

  // Part of Mastra's documented Processor interface, but not actually
  // invoked by this version's workflow-step processor pipeline (see
  // processInput below) - kept for interface compliance / other execution
  // paths that may call it.
  onViolation = (violation: ProcessorViolation): void => {
    recordGuardrailViolation({ ...violation, userMessage: this.userMessage });
  };

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
        // Mastra runs input processors as workflow steps in this version, and
        // that path's error handling never calls onViolation (only a separate,
        // unused ProcessorRunner path does) - record the block message here,
        // synchronously before abort() throws, rather than relying on it.
        recordGuardrailViolation({
          processorId: this.id,
          message: "blocked",
          detail: { phrase },
          userMessage: this.userMessage,
        });

        abort("Message blocked: contains disallowed content", {
          retry: false,
          metadata: { phrase },
        });
      }
    }

    return messages;
  }
}
