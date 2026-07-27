import {
  InMemoryAgentRunner,
  type AgentRunnerConnectRequest,
} from "@copilotkit/runtime/v2";
import { EventType, type BaseEvent, type Message } from "@ag-ui/client";
import { Observable } from "rxjs";
import { Memory } from "@mastra/memory";
import type {
  MastraDBMessage,
  MastraMessagePart,
} from "@mastra/core/agent/message-list";
import { getStorage } from "./storage";

// Read-only: no agent config (instructions/model/tools) is needed to recall
// persisted messages, so one Memory instance is safely shared across every
// MastraBackedAgentRunner regardless of resourceId.
const memory = new Memory({ storage: getStorage() });

/**
 * CopilotKit's OSS `InMemoryAgentRunner` (the default runner behind
 * `registerCopilotKit`) keeps chat history in a process-local `Map`, so a
 * thread's messages hydrate on `agent/connect` only for as long as the same
 * `pnpm run dev` process that ran them stays alive. Threads created before a
 * restart still show up in the sidebar (backed by Mastra's real LibSQL
 * memory via the app's own /api/memory/threads routes) but the chat popup
 * shows them empty, because `InMemoryAgentRunner.connect()` has nothing left
 * for that threadId once the process restarts.
 *
 * This subclass changes only `connect()`. It tries the fast in-process path
 * first (unchanged behavior for threads created since the last restart —
 * `agent.messages` there already came from live streamed events, so there's
 * nothing to rebuild) and falls back to reconstructing a MESSAGES_SNAPSHOT
 * from Mastra memory only when that path yields nothing.
 */
export class MastraBackedAgentRunner extends InMemoryAgentRunner {
  private readonly resourceId: string;

  constructor(resourceId: string) {
    super();
    this.resourceId = resourceId;
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const live$ = super.connect(request);
    return new Observable<BaseEvent>((subscriber) => {
      let gotAny = false;
      const subscription = live$.subscribe({
        next: (event) => {
          gotAny = true;
          subscriber.next(event);
        },
        error: (error) => subscriber.error(error),
        complete: () => {
          if (gotAny) {
            subscriber.complete();
            return;
          }
          this.buildSnapshotEvents(request.threadId)
            .then((events) => {
              for (const event of events) subscriber.next(event);
            })
            .catch((error) => {
              console.error(
                `[MastraBackedAgentRunner] Failed to hydrate thread ${request.threadId} from Mastra memory:`,
                error,
              );
            })
            .finally(() => subscriber.complete());
        },
      });
      return () => subscription.unsubscribe();
    });
  }

  /**
   * The client's event-order verifier (ag-ui/client's `verifyEvents`, run on
   * every connect/run stream) rejects anything but RUN_STARTED/RUN_ERROR as
   * the first event, and requires RUN_FINISHED to close a run out — a bare
   * MESSAGES_SNAPSHOT on its own is invalid. So a hydrated thread is framed
   * as a trivial, already-finished run: RUN_STARTED -> MESSAGES_SNAPSHOT ->
   * RUN_FINISHED, exactly like a real historic run's compacted events would
   * look, just synthesized from storage instead of replayed from memory.
   */
  private async buildSnapshotEvents(threadId: string): Promise<BaseEvent[]> {
    const { messages } = await memory.recall({
      threadId,
      resourceId: this.resourceId,
      page: 0,
      perPage: false,
    });
    const converted = messages.flatMap(convertMastraMessageToAGUI);
    if (converted.length === 0) return [];

    const runId = crypto.randomUUID();
    return [
      { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: converted,
      } as BaseEvent,
      { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent,
    ];
  }
}

/**
 * Converts one persisted Mastra message into zero or more AG-UI messages.
 * An assistant turn with tool calls becomes an assistant message (text +
 * toolCalls) followed by one "tool" message per completed tool result —
 * mirroring how CopilotKit streams a live run, so useRenderTool cards render
 * the same way on reload as they did live.
 *
 * Best-effort only: attachments, reasoning, source, and in-flight/suspended
 * tool-invocation parts are dropped. This replays what a finished run looked
 * like, not every part type Mastra can persist.
 */
function convertMastraMessageToAGUI(message: MastraDBMessage): Message[] {
  const parts = message.content?.parts ?? [];

  if (message.role === "system") {
    const text = extractText(parts);
    return text ? [{ role: "system", id: message.id, content: text }] : [];
  }

  if (message.role === "user") {
    const text = extractText(parts);
    return text ? [{ role: "user", id: message.id, content: text }] : [];
  }

  if (message.role === "assistant") {
    return convertAssistantMessage(message.id, parts);
  }

  // 'signal' messages are workflow/system bookkeeping, not chat turns.
  return [];
}

function extractText(parts: MastraMessagePart[]): string {
  return parts
    .filter(
      (part): part is Extract<MastraMessagePart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function convertAssistantMessage(
  messageId: string,
  parts: MastraMessagePart[],
): Message[] {
  const text = extractText(parts);
  const toolInvocationParts = parts.filter(
    (part): part is Extract<MastraMessagePart, { type: "tool-invocation" }> =>
      part.type === "tool-invocation",
  );

  const toolCalls = toolInvocationParts.map((part) => ({
    id: part.toolInvocation.toolCallId,
    type: "function" as const,
    function: {
      name: part.toolInvocation.toolName,
      arguments: JSON.stringify(
        "rawInput" in part.toolInvocation &&
          part.toolInvocation.rawInput !== undefined
          ? part.toolInvocation.rawInput
          : (part.toolInvocation.args ?? {}),
      ),
    },
  }));

  const toolResultMessages: Message[] = toolInvocationParts
    .filter((part) => part.toolInvocation.state === "result")
    .map((part) => {
      const result = (part.toolInvocation as { result?: unknown }).result;
      // Tool handlers in this app return plain objects, but by the time
      // Mastra persists them `result` is already the JSON-stringified form
      // (that's what the live AG-UI TOOL_CALL_RESULT event carries as
      // `content`, which useRenderTool's JSON.parse expects). Re-stringifying
      // a string here would double-encode it and break every render-tool
      // parser downstream.
      const content = typeof result === "string" ? result : JSON.stringify(result ?? null);
      return {
        role: "tool",
        id: `${messageId}-tool-${part.toolInvocation.toolCallId}`,
        toolCallId: part.toolInvocation.toolCallId,
        content,
      };
    });

  if (!text && toolCalls.length === 0) return toolResultMessages;

  const assistantMessage: Message = {
    role: "assistant",
    id: messageId,
    content: text || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };

  return [assistantMessage, ...toolResultMessages];
}
