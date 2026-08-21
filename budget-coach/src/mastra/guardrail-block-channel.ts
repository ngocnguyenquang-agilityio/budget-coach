import { AsyncLocalStorage } from "node:async_hooks";

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
}: {
  processorId?: string;
  message: string;
  detail?: unknown;
}): void => {
  console.warn("[guardrail]", processorId, message, detail);
};

// Shared by every guardrail's onViolation callback and its processInput
// block branch, so the log+record pairing lives in one place instead of
// being duplicated per guardrail.
export const recordGuardrailViolation = ({
  processorId,
  message,
  detail,
  userMessage,
}: {
  processorId?: string;
  message: string;
  detail?: unknown;
  userMessage?: string;
}): void => {
  logGuardrailViolation({ processorId, message, detail });
  if (userMessage) recordGuardrailBlock(userMessage);
};
