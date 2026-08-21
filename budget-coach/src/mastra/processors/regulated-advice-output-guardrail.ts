import type { Processor, ProcessOutputResultArgs, ProcessorMessageResult } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";
import { logGuardrailViolation } from "../guardrail-block-channel";

// Output-side counterpart to the input guardrails: the Coach's own response
// can drift into regulated-advice territory even when the user's question
// didn't trip anything on the way in (e.g. volunteering a stock tip
// unprompted). Rewrites the response instead of calling abort() — with
// `useProcessedFinalText` enabled on the bridged agent (src/agent.ts), only
// the rewritten text ever reaches the user, so there's no drift visible
// before the redirect the way there would be with a live-streamed abort.
export class RegulatedAdviceOutputGuardrail implements Processor {
  readonly id = "regulated-advice-output-guardrail";
  private readonly blockedKeywords: string[];
  private readonly redirectMessage: string;

  constructor({ blockedKeywords, redirectMessage }: { blockedKeywords: string[]; redirectMessage: string }) {
    this.blockedKeywords = blockedKeywords;
    this.redirectMessage = redirectMessage;
  }

  processOutputResult({ messages, result }: ProcessOutputResultArgs): ProcessorMessageResult {
    const text = result.text.toLowerCase();
    const matchedKeyword = this.blockedKeywords.find((keyword) => text.includes(keyword.toLowerCase()));

    if (!matchedKeyword) return messages;

    logGuardrailViolation({
      processorId: this.id,
      message: "Response blocked: drifted into regulated-advice territory",
      detail: { matchedKeyword },
    });

    return this.replaceLastAssistantText(messages, this.redirectMessage);
  }

  private replaceLastAssistantText(messages: MastraDBMessage[], replacementText: string): MastraDBMessage[] {
    const lastAssistantIndex = [...messages].reverse().findIndex((message) => message.role === "assistant");
    if (lastAssistantIndex === -1) return messages;

    const index = messages.length - 1 - lastAssistantIndex;
    const original = messages[index];
    const replaced: MastraDBMessage = {
      ...original,
      content: {
        ...original.content,
        parts: [{ type: "text", text: replacementText }],
        content: replacementText,
      },
    };

    const next = [...messages];
    next[index] = replaced;
    return next;
  }
}
