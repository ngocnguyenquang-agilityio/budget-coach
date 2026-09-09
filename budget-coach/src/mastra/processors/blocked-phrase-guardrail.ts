import { RegexFilterProcessor } from "@mastra/core/processors";
import type { Processor, ProcessInputArgs, ProcessInputResult, ProcessorViolation } from "@mastra/core/processors";
import { TripWire } from "@mastra/core/agent";
import type { MastraDBMessage } from "@mastra/core/memory";
import { recordGuardrailViolation } from "../guardrails/block-channel";
import { getMessageText } from "../scorers/message-text";

const escapeRegExp = (phrase: string): string => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Wraps Mastra's built-in RegexFilterProcessor (does the actual matching) to
// scope it to just the latest user message (it otherwise re-scans resent
// history) and to record the block's userMessage on the guardrail-block
// channel before its TripWire propagates (it bypasses `abort`, so this is
// the only synchronous hook available).
export class BlockedPhraseGuardrail implements Processor {
  readonly id = "blocked-phrase-guardrail";
  private readonly regexFilter: RegexFilterProcessor;
  private readonly userMessage?: string;

  constructor({ blockedPhrases, userMessage }: { blockedPhrases: string[]; userMessage?: string }) {
    this.userMessage = userMessage;
    this.regexFilter = new RegexFilterProcessor({
      rules: blockedPhrases.map((phrase) => ({
        name: phrase,
        pattern: new RegExp(escapeRegExp(phrase), "i"),
      })),
      strategy: "block",
      phase: "input",
    });
  }

  // Part of Mastra's documented Processor interface, but not actually
  // invoked by this version's workflow-step processor pipeline (see
  // processInput below) - kept for interface compliance / other execution
  // paths that may call it.
  onViolation = (violation: ProcessorViolation): void => {
    recordGuardrailViolation({ ...violation, userMessage: this.userMessage });
  };

  processInput({ messages, tracingContext }: ProcessInputArgs): ProcessInputResult {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const text = latestUserMessage ? getMessageText(latestUserMessage) : "";
    if (!text) return messages;

    const syntheticMessage = {
      role: "user",
      content: { parts: [{ type: "text", text }] },
    } as unknown as MastraDBMessage;

    try {
      this.regexFilter.processInput({ messages: [syntheticMessage] } as ProcessInputArgs);
    } catch (error) {
      if (error instanceof TripWire) {
        // Mastra runs input processors as workflow steps in this version, and
        // that path's error handling never calls onViolation (only a separate,
        // unused ProcessorRunner path does) - record the block message here,
        // synchronously before the TripWire propagates, rather than relying on it.
        recordGuardrailViolation({
          processorId: this.id,
          message: "blocked",
          detail: error.options?.metadata,
          userMessage: this.userMessage,
          span: tracingContext?.currentSpan,
        });
      }
      throw error;
    }

    return messages;
  }
}
