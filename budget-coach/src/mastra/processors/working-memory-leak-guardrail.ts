import type { Processor, ProcessOutputResultArgs, ProcessorMessageResult } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";
import { logGuardrailViolation } from "../guardrails/block-channel";

const MIN_MARKER_MATCHES = 3;

// Brace-matches from `start` (a `{`), string/escape aware so a `}` inside a
// quoted value (pot name, nickname, ...) doesn't end the object early.
// Returns the index of the matching `}`, or -1 if the text ends unbalanced.
const matchBrace = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

// Scans left to right for the smallest top-level `{...}` span whose content
// contains at least MIN_MARKER_MATCHES distinct working-memory field names.
// Brace-matching (rather than a fixed-key-order regex) is required because
// Mastra serializes working memory in whatever key order the resource
// currently holds, not BudgetStateSchema's declaration order.
const findLeakedWorkingMemorySpan = (
  text: string,
  markers: readonly string[],
): [number, number] | null => {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const end = matchBrace(text, i);
    if (end === -1) continue;
    const candidate = text.slice(i, end + 1);
    const matches = markers.filter((marker) => candidate.includes(marker)).length;
    if (matches >= MIN_MARKER_MATCHES) return [i, end + 1];
  }
  return null;
};

type TextPart = Extract<MastraDBMessage["content"]["parts"][number], { type: "text" }>;

// Defense-in-depth backstop alongside regulatedAdviceOutputGuardrail: Mastra's
// read-only working-memory injection (coach.ts, `agentManaged: false`) tells
// the model "the user will not see this data directly", but Cerebras's
// gpt-oss-120b doesn't reliably honor that — observed pasting the raw
// working-memory JSON it was given for context straight into a reply,
// mid-sentence, before self-correcting into the real answer. Unlike the
// regulated-advice guardrail this redacts just the leaked span rather than
// discarding the whole reply, since the surrounding text is normally the
// real answer and the leaked data (limits, pot balances, preferences) isn't
// itself a safety concern.
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

        const span = findLeakedWorkingMemorySpan(part.text, this.markers);
        if (!span) return part;

        const [start, end] = span;
        leakedLength += end - start;
        changed = true;
        const cleanedText = `${part.text.slice(0, start)}${part.text.slice(end)}`
          .replace(/[ \t]{2,}/g, " ")
          .trim();
        return { ...part, text: cleanedText } satisfies TextPart;
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
