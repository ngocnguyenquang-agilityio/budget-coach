import type { Processor, ProcessInputArgs, ProcessInputResult, ProcessorViolation } from "@mastra/core/processors";
import { recordGuardrailViolation } from "../guardrail-block-channel";
import { getMessageText } from "../scorers/message-text";

// Blocks only when the latest user message contains BOTH a financial
// instrument word AND a decision-seeking word, rather than matching a fixed
// list of exact phrases. Catches paraphrases like "Should I buy Nvidia
// stock?" that a substring match on "should i buy stock" would miss, without
// needing a new list entry for every ticker/wording.
export class FinancialAdviceGuardrail implements Processor {
  readonly id = "financial-advice-guardrail";
  private readonly instrumentKeywords: string[];
  private readonly decisionKeywords: string[];
  private readonly userMessage?: string;

  constructor({
    instrumentKeywords,
    decisionKeywords,
    userMessage,
  }: {
    instrumentKeywords: string[];
    decisionKeywords: string[];
    userMessage?: string;
  }) {
    this.instrumentKeywords = instrumentKeywords;
    this.decisionKeywords = decisionKeywords;
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
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const text = latestUserMessage ? getMessageText(latestUserMessage).toLowerCase() : "";

    const matchedInstrument = this.instrumentKeywords.find((keyword) => text.includes(keyword.toLowerCase()));
    const matchedDecision = this.decisionKeywords.find((keyword) => text.includes(keyword.toLowerCase()));

    if (matchedInstrument && matchedDecision) {
      // Mastra runs input processors as workflow steps in this version, and
      // that path's error handling never calls onViolation (only a separate,
      // unused ProcessorRunner path does) - record the block message here,
      // synchronously before abort() throws, rather than relying on it.
      recordGuardrailViolation({
        processorId: this.id,
        message: "blocked",
        detail: { matchedInstrument, matchedDecision },
        userMessage: this.userMessage,
      });

      abort("Message blocked: financial-advice request", {
        retry: false,
        metadata: { matchedInstrument, matchedDecision },
      });
    }

    return messages;
  }
}
