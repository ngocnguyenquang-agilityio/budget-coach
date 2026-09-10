import type { Message } from "@ag-ui/client";

// Rebuilds an AG-UI transcript from messages persisted by Mastra (the reverse
// of @ag-ui/mastra's convertAGUIMessagesToMastra, which isn't provided for us).

// A Mastra v2 message: { content: { format: 2, parts: [...] } }. Tool calls
// live inside the ASSISTANT message's parts, not as a separate tool row.
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

// Id suffix @ag-ui/mastra uses for assistant text that follows a tool call.
// Reusing it keeps replayed messages matching MastraAgent.selectNewMessages'
// dedup, so they aren't re-sent/duplicated on the next turn.
const TEXT_CONTINUATION_SUFFIX = "-agui-text";

// toolName Mastra assigns a merged-back tool result it can't attribute, on a
// later message than the call it answers. Not renderable (no name to match a
// useRenderTool), but its toolCallId is reattached to the original call.
const UNRESOLVED_TOOL_NAME = "unknown";

// useConfigureSuggestions's internal call to generate suggestion pills, run
// against this same agent and persisted like a normal turn — filtered out so
// it doesn't show up as a chat bubble on replay.
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

// Normalizes a tool result to the JSON string useRenderTool expects — server
// tools persist an object, merged-back frontend results are already a string.
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

// toolCallIds that some part names with a real tool name — used to admit
// results whose own part lost its toolName (see UNRESOLVED_TOOL_NAME).
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
      // Unnamed and unmatched — nothing to render.
      continue;
    }

    // No result means still pending (suspended approval, unanswered frontend
    // tool) — skip emitting a tool message so the renderer stays in-progress.
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
    // system/signal roles have no user-visible transcript.
    return [];
  });
};
