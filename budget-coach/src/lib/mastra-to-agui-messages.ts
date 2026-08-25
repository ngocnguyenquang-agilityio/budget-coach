import type { Message } from "@ag-ui/client";

// Rebuilds an AG-UI transcript from messages persisted by Mastra, so re-opening
// a thread restores what the user saw — including tool calls and their
// generative-UI cards.
//
// @ag-ui/mastra only ships the opposite direction (convertAGUIMessagesToMastra),
// so this mapping is ours. The shapes below were confirmed against real rows in
// mastra_messages rather than types alone.

// Mastra stores a v2 message as { content: { format: 2, parts: [...] } }, with
// tool calls nested inside the ASSISTANT message — there is no separate tool row.
type MastraToolInvocation = {
  state?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
};

type MastraMessagePart = {
  type?: string;
  text?: string;
  toolInvocation?: MastraToolInvocation;
};

export type MastraStoredMessage = {
  id: string;
  role?: string;
  createdAt?: string | number | Date;
  content?: { parts?: MastraMessagePart[] } | null;
};

// @ag-ui/mastra splits assistant text that follows a tool call onto a
// continuation id (MastraAgent.ASSISTANT_TEXT_CONTINUATION_SUFFIX). Reusing the
// exact same id keeps a restored transcript identical to the live stream, which
// matters beyond React keys: MastraAgent.selectNewMessages drops already-persisted
// ids, so replayed messages re-sent on the next turn are not duplicated in
// mastra_messages.
const TEXT_CONTINUATION_SUFFIX = "-agui-text";

// Mastra records a merged-back tool result it can no longer attribute with this
// literal toolName, on a LATER message than the call it answers. Real example
// from this app: an approveBudget call persisted as `state: "call"`, and its
// approval arriving afterwards as `{ toolName: "unknown", result:
// '{"decision":"approve"}' }`.
//
// Such a part can't contribute an assistant toolCall — no name means no
// useRenderTool match. Its `toolCallId` is still good though, so the result is
// re-attached to the original call (see resolveKnownToolCallIds), which is what
// keeps a completed approval from replaying as though it were still pending.
const UNRESOLVED_TOOL_NAME = "unknown";

// useConfigureSuggestions (dynamic, providerAgentId-based) runs a secondary
// call against this same agent to generate suggestion pills, forcing a
// copilotkitSuggest tool call. Because it shares our Mastra-backed agent, that
// exchange gets persisted into the real thread like any other turn — this
// filters it back out at replay time so reopening a thread doesn't show the
// internal instruction (which embeds the full tool-schema JSON) as a chat
// bubble. See @copilotkit/core's generateSuggestions for the exact prompt.
const SUGGESTION_PROMPT_PREFIX = "Suggest what the user could say next.";
const SUGGESTION_TOOL_NAME = "copilotkitSuggest";

const isSuggestionExchangeMessage = (message: MastraStoredMessage): boolean => {
  const parts = message.content?.parts ?? [];

  if (message.role === "user") {
    return parts.some(
      (part) => part.type === "text" && (part.text ?? "").startsWith(SUGGESTION_PROMPT_PREFIX),
    );
  }

  if (message.role === "assistant") {
    return parts.some(
      (part) => part.type === "tool-invocation" && part.toolInvocation?.toolName === SUGGESTION_TOOL_NAME,
    );
  }

  return false;
};

const toMillis = (createdAt: MastraStoredMessage["createdAt"]): number => {
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === "number") return createdAt;
  if (typeof createdAt === "string") {
    const parsed = Date.parse(createdAt);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

// A tool `result` reaches useRenderTool as a JSON string and is parsed by
// parseToolResult. Server tools persist an object; a merged-back frontend tool
// result is already a string — passing that through JSON.stringify again would
// double-encode it and break every renderer.
const toResultString = (result: unknown): string =>
  typeof result === "string" ? result : JSON.stringify(result ?? null);

const textOf = (part: MastraMessagePart): string => part.text ?? "";

const isRenderableInvocation = (
  invocation: MastraToolInvocation | undefined,
): invocation is MastraToolInvocation & { toolCallId: string; toolName: string } =>
  Boolean(
    invocation?.toolCallId &&
      invocation.toolName &&
      invocation.toolName !== UNRESOLVED_TOOL_NAME,
  );

const convertUserMessage = (message: MastraStoredMessage): Message[] => {
  const content = (message.content?.parts ?? [])
    .filter((part) => part.type === "text")
    .map(textOf)
    .join("");

  if (!content) return [];
  return [{ id: message.id, role: "user", content }];
};

// Every toolCallId that some part names with a real tool. A result whose own
// part lost its toolName is only replayed when its id appears here — otherwise
// it would be an orphan tool message answering a call no transcript contains.
const resolveKnownToolCallIds = (
  stored: readonly MastraStoredMessage[],
): Set<string> => {
  const ids = new Set<string>();

  for (const message of stored) {
    for (const part of message.content?.parts ?? []) {
      const invocation = part.toolInvocation;
      if (isRenderableInvocation(invocation)) ids.add(invocation.toolCallId);
    }
  }

  return ids;
};

const convertAssistantMessage = (
  message: MastraStoredMessage,
  knownToolCallIds: Set<string>,
): Message[] => {
  const parts = message.content?.parts ?? [];

  let leadingText = "";
  let trailingText = "";
  let seenToolCall = false;
  const toolCalls: NonNullable<
    Extract<Message, { role: "assistant" }>["toolCalls"]
  > = [];
  const toolResults: Message[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (seenToolCall) trailingText += textOf(part);
      else leadingText += textOf(part);
      continue;
    }

    if (part.type !== "tool-invocation") continue;

    const invocation = part.toolInvocation;
    if (!invocation?.toolCallId) continue;

    const renderable = isRenderableInvocation(invocation);

    if (renderable) {
      seenToolCall = true;
      toolCalls.push({
        id: invocation.toolCallId,
        type: "function",
        function: {
          name: invocation.toolName,
          arguments: JSON.stringify(invocation.args ?? {}),
        },
      });
    } else if (!knownToolCallIds.has(invocation.toolCallId)) {
      // No name here and no call anywhere else to attach to — nothing renderable.
      continue;
    }

    // A call with no result is a genuine state: a suspended approval gate, or a
    // frontend tool the user never answered. Emitting no tool message leaves the
    // renderer showing its in-progress branch, which is what the live run did.
    if (invocation.state === "result") {
      toolResults.push({
        id: `${invocation.toolCallId}-result`,
        role: "tool",
        toolCallId: invocation.toolCallId,
        content: toResultString(invocation.result),
      });
    }
  }

  const messages: Message[] = [];

  if (leadingText || toolCalls.length > 0) {
    messages.push({
      id: message.id,
      role: "assistant",
      ...(leadingText ? { content: leadingText } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }

  messages.push(...toolResults);

  if (trailingText) {
    messages.push({
      id: `${message.id}${TEXT_CONTINUATION_SUFFIX}`,
      role: "assistant",
      content: trailingText,
    });
  }

  return messages;
};

export const mastraToAGUIMessages = (
  stored: readonly MastraStoredMessage[],
): Message[] => {
  const ordered = [...stored]
    .filter((message) => !isSuggestionExchangeMessage(message))
    .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));

  const knownToolCallIds = resolveKnownToolCallIds(ordered);

  return ordered.flatMap((message) => {
    if (message.role === "user") return convertUserMessage(message);
    if (message.role === "assistant") {
      return convertAssistantMessage(message, knownToolCallIds);
    }
    // system / signal roles carry no transcript the user ever saw.
    return [];
  });
};
