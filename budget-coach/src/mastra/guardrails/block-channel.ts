import { AsyncLocalStorage } from "node:async_hooks";
import { SpanType } from "@mastra/core/observability";
import type { AnySpan } from "@mastra/core/observability";
import { OBSERVABILITY_EVENTS } from "@/constants/observability";

// Only the one method is needed; narrowing keeps callers free to pass any span.
export type GuardrailSpan = Pick<AnySpan, "createEventSpan">;

// Leaf module (no imports from "@/mastra") so guardrail processors can use
// it without creating a circular import back through the Mastra instance
// (src/mastra/index.ts imports the agents which import the guardrails).

export interface GuardrailBlockStore {
  userMessage?: string;
  sawAssistantText: boolean;
}

// Bridges a guardrail's onViolation callback (which only has processor-local
// context) to the per-request run() wrapper in src/agent.ts, which needs the
// friendly message to render when a block produced no assistant text.
export const guardrailBlockChannel = new AsyncLocalStorage<GuardrailBlockStore>();

export const recordGuardrailBlock = (userMessage: string): void => {
  const store = guardrailBlockChannel.getStore();
  if (store) store.userMessage = userMessage;
};

export const logGuardrailViolation = ({
  processorId,
  message,
  detail,
  span,
}: {
  processorId?: string;
  message: string;
  detail?: unknown;
  span?: GuardrailSpan;
}): void => {
  console.warn("[guardrail]", processorId, message, detail);
  // Event span (no endTime) — a block is an instant, not an interval. Spans are
  // the only signal LibSQL persists, so this is what makes blocks countable.
  span?.createEventSpan({
    name: `guardrail block: ${processorId ?? "unknown"}`,
    type: SpanType.GENERIC,
    metadata: { event: OBSERVABILITY_EVENTS.guardrailBlock, processorId },
    output: detail,
  });
};

// Shared by every guardrail's onViolation callback and its processInput
// block branch, so the log+record pairing lives in one place instead of
// being duplicated per guardrail.
export const recordGuardrailViolation = ({
  processorId,
  message,
  detail,
  userMessage,
  span,
}: {
  processorId?: string;
  message: string;
  detail?: unknown;
  userMessage?: string;
  span?: GuardrailSpan;
}): void => {
  logGuardrailViolation({ processorId, message, detail, span });
  if (userMessage) recordGuardrailBlock(userMessage);
};
