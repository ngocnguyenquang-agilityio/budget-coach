import type { Processor, ProcessOutputResultArgs, ProcessorMessageResult } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";
import { logGuardrailViolation } from "../guardrails/block-channel";
import { redactWorkingMemoryLeak } from "../lib/redact-working-memory-leak";

type TextPart = Extract<MastraDBMessage["content"]["parts"][number], { type: "text" }>;

// Defense-in-depth backstop alongside regulatedAdviceOutputGuardrail: Mastra's
// read-only working-memory injection (coach.ts, `agentManaged: false`) tells
// the model "the user will not see this data directly", but Cerebras's
// gpt-oss-120b doesn't reliably honor that — observed pasting the raw
// working-memory JSON it was given for context straight into a reply,
// mid-sentence, before self-correcting into the real answer. Unlike the
// regulated-advice guardrail this redacts just the leaked span(s) rather than
// discarding the whole reply, since the surrounding text is normally the
// real answer and the leaked data (limits, pot balances, preferences) isn't
// itself a safety concern.
//
// This is the post-generation half of the fix; the AG-UI run wrapper
// (src/agent.ts) runs the same `redactWorkingMemoryLeak` on the streamed
// TEXT_MESSAGE_CHUNK, which is what the user actually sees — a
// processOutputResult rewrite does not make it into @ag-ui/mastra's re-emitted
// finish-chunk text. Keeping both means the stored message is clean too.
//
// Operates per text part of the actual `messages` array, not `result.text`
// (the OutputResult's text accumulated across every step of the Coach's up-
// to-8-step run) — redacting via the accumulated text and writing it back
// onto a single "last assistant message" would corrupt whichever message
// truly holds the leak and destroy any tool-invocation/step-start parts
// sitting alongside its text.
export class WorkingMemoryLeakGuardrail implements Processor {
  readonly id = "working-memory-leak-guardrail";

  constructor(private readonly markers: readonly string[]) {}

  processOutputResult({ messages, tracingContext }: ProcessOutputResultArgs): ProcessorMessageResult {
    let leakedLength = 0;

    const next = messages.map((message) => {
      if (message.role !== "assistant") return message;
      const parts = message.content.parts;
      if (!parts) return message;

      let changed = false;
      const cleanedParts = parts.map((part) => {
        if (part.type !== "text") return part;

        const { text: cleanedText, redactedLength, garbled } = redactWorkingMemoryLeak(part.text, this.markers);
        if (redactedLength === 0) return part;

        leakedLength += redactedLength;
        changed = true;
        // A turn that was mostly leak leaves shredded residue (stray `$`, lone
        // `...`, dangling `—?`) — worthless as stored context and a
        // re-garbling source in the next turn's `lastMessages`. Store nothing
        // for it rather than the crumbs; the AG-UI wrapper (src/agent.ts)
        // already shows the user the empty-response fallback for this turn.
        return { ...part, text: garbled ? "" : cleanedText } satisfies TextPart;
      });

      if (!changed) return message;

      const cleanedContent = cleanedParts
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("");

      return {
        ...message,
        content: { ...message.content, parts: cleanedParts, content: cleanedContent },
      };
    });

    if (leakedLength === 0) return messages;

    logGuardrailViolation({
      processorId: this.id,
      message: "Redacted a leaked working-memory JSON blob from the Coach's response",
      detail: { leakedLength },
      span: tracingContext?.currentSpan,
    });

    return next;
  }
}
