import { randomUUID } from "node:crypto";
import { MastraAgent } from "@ag-ui/mastra";
import type { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";
import { mastra } from "@/mastra";
import { guardrailBlockChannel, type GuardrailBlockStore } from "@/mastra/guardrails/block-channel";
import { COACH_EMPTY_RESPONSE_FALLBACK, COACH_ERROR_FALLBACK } from "@/constants/coach-fallback";
import { reportError } from "@/lib/report-error";
import { redactWorkingMemoryLeak } from "@/mastra/lib/redact-working-memory-leak";
import { WORKING_MEMORY_LEAK_MARKERS } from "@/constants/guardrail-phrases";

// Mastra's tripwire chunk (emitted when a guardrail calls abort()) is
// silently dropped by @ag-ui/mastra's chunk handler — there's no public
// event for it. So a blocked turn otherwise reaches the browser as a bare
// RUN_FINISHED with no assistant text. This wraps MastraAgent.run() to
// inject a synthetic assistant text message carrying the guardrail's
// friendly userMessage whenever a guardrail fired (via onViolation, see
// src/mastra/guardrails/block-channel.ts) but no real text was produced.
//
// The same wrapper also covers a second silent-turn cause: gpt-oss-120b on
// Cerebras can exhaust its step budget on reasoning/tool calls and end with
// an empty content channel (see coach.ts:72-83) — tools ran, but the user
// sees no reply. On a clean RUN_FINISHED with no assistant text and no
// guardrail message, we echo the last tool's human-readable `message`
// (e.g. addRecurringSchedule's "Recorded 'Salary' as a recurring income…")
// or, failing that, a neutral fallback.
// Events that carry the assistant's reply text in a `delta` field. With
// `useProcessedFinalText` enabled (see enableProcessedFinalText below),
// @ag-ui/mastra buffers the reply and re-emits it as a single
// TEXT_MESSAGE_CHUNK whose delta is the whole answer — so redacting each
// delta here catches a complete leaked working-memory blob (gpt-oss-120b
// sometimes dumps its read-only working memory into the reply; see
// src/mastra/lib/redact-working-memory-leak.ts). This is the only layer the
// browser actually renders: a processOutputResult rewrite does not reach the
// re-emitted finish-chunk text.
const ASSISTANT_TEXT_DELTA_EVENT_TYPES: EventType[] = [
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_CHUNK,
];

// Redacts a leaked working-memory blob from a text-delta event. Returns the
// (possibly rewritten) event plus whether any real reply text survives, so a
// turn whose entire content was the leak still falls through to the fallback
// instead of showing the user an empty bubble.
const redactTextDeltaEvent = (event: BaseEvent): { event: BaseEvent; hasText: boolean } => {
  const delta = (event as { delta?: unknown }).delta;
  if (typeof delta !== "string" || delta.length === 0) return { event, hasText: false };

  const { text, redactedLength } = redactWorkingMemoryLeak(delta, WORKING_MEMORY_LEAK_MARKERS);
  if (redactedLength === 0) return { event, hasText: delta.trim().length > 0 };
  return { event: { ...event, delta: text } as BaseEvent, hasText: text.trim().length > 0 };
};

// Best-effort extraction of a tool result's user-facing `message` field.
// Tool results arrive as a JSON string on the TOOL_CALL_RESULT event's
// `content`; parse defensively and ignore anything without a string message.
const toolResultMessage = (event: BaseEvent): string | undefined => {
  const content = (event as { content?: unknown }).content;
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string") {
      return (parsed as { message: string }).message;
    }
  } catch {
    // Not JSON, or not the shape we expected — no message to echo.
  }
  return undefined;
};

// CopilotKit's runtime clones the agent per request (`agents[id].clone()` in
// @copilotkit/runtime's agent-utils), and MastraAgent.clone() rebuilds a
// brand-new instance via `new MastraAgent(this.config)` — any mutation made
// to a specific instance after construction (an `agent.run = ...`
// monkeypatch included) is silently discarded by that clone. Patching the
// shared class prototype instead survives every clone. Guarded so repeated
// createLocalAgents() calls (one per request) only patch once.
let runPatched = false;

const patchMastraAgentRunOnce = (): void => {
  if (runPatched) return;
  runPatched = true;

  const originalRun = MastraAgent.prototype.run;

  // A `function` expression, not an arrow, is required here: this patches a
  // shared prototype method, so `this` must be re-bound per call to whichever
  // instance (or clone) invokes `.run()` - an arrow function would instead
  // lexically capture this module's `this` (undefined) for every call.
  MastraAgent.prototype.run = function (
    this: MastraAgent,
    input: RunAgentInput
  ): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const store: GuardrailBlockStore = { sawAssistantText: false };
      // Last tool result's user-facing message, echoed if the turn ends with
      // no assistant text (the empty-content-channel case described above).
      let lastToolMessage: string | undefined;
      // Tool calls started in this run but not yet resolved by a result. A
      // frontend `useHumanInTheLoop` tool (confirmTransactions, chooseCategory,
      // provideSavingsGoal) is dispatched to the browser: CopilotKit ends the
      // run with RUN_FINISHED so the client can render the card, and the tool's
      // RESULT only arrives in the *next* (continuation) run — where the model
      // produces its actual reply. Such a run legitimately ends with no
      // assistant text, so it must NOT get the empty-response fallback, or a
      // spurious "Sorry…" bubble lands between the card and the real answer.
      // Server-side tools resolve within the same run, leaving this set empty,
      // so the genuine dead-turn fallback still fires.
      const pendingToolCalls = new Set<string>();

      return guardrailBlockChannel.run(store, () => {
        const subscription = originalRun.call(this, input).subscribe({
          next: (event) => {
            let outgoing = event;
            if (ASSISTANT_TEXT_DELTA_EVENT_TYPES.includes(event.type)) {
              const { event: redacted, hasText } = redactTextDeltaEvent(event);
              outgoing = redacted;
              // Only count text that survives redaction: a turn whose entire
              // reply was the leaked blob should still reach the fallback below
              // rather than emit an empty bubble.
              if (hasText) store.sawAssistantText = true;
            }
            if (event.type === EventType.TOOL_CALL_START) {
              const id = (event as { toolCallId?: string }).toolCallId;
              if (id) pendingToolCalls.add(id);
            }
            if (event.type === EventType.TOOL_CALL_RESULT) {
              const id = (event as { toolCallId?: string }).toolCallId;
              if (id) pendingToolCalls.delete(id);
              lastToolMessage = toolResultMessage(event) ?? lastToolMessage;
            }

            const isTerminal = event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
            // A guardrail block wins (fires on either terminal type); otherwise
            // a clean RUN_FINISHED with no text gets the tool-echo/generic
            // fallback — unless the run is yielding to an unresolved frontend
            // tool call (see pendingToolCalls above), in which case a
            // continuation run will carry the reply and no fallback is due.
            // A RUN_ERROR with no text (a genuine failure once the Cerebras
            // retries are exhausted) gets COACH_ERROR_FALLBACK: without it the
            // stream just closes and the user sees the reply silently stop. The
            // message is explicitly worded as an error, not a normal reply, so
            // this surfaces the failure rather than masking it.
            const fallbackText = !store.sawAssistantText
              ? store.userMessage ??
                (event.type === EventType.RUN_FINISHED && pendingToolCalls.size === 0
                  ? lastToolMessage ?? COACH_EMPTY_RESPONSE_FALLBACK
                  : event.type === EventType.RUN_ERROR
                    ? COACH_ERROR_FALLBACK
                    : undefined)
              : undefined;
            if (event.type === EventType.RUN_ERROR && !store.userMessage) {
              reportError(new Error((event as { message?: string }).message ?? "Coach run error"), {
                source: "coach-run",
                event: EventType.RUN_ERROR,
              });
            }
            if (isTerminal && fallbackText) {
              const messageId = randomUUID();
              subscriber.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
              subscriber.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: fallbackText } as BaseEvent);
              subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
            }

            subscriber.next(outgoing);
          },
          error: (err) => {
            reportError(err, { source: "coach-run" });
            subscriber.error(err);
          },
          complete: () => subscriber.complete(),
        });

        return () => subscription.unsubscribe();
      });
    });
  };
};

// `useProcessedFinalText` has the same clone problem: setting it on the
// instance (`coach.useProcessedFinalText = true`) doesn't survive `clone()`
// either, because the clone's constructor re-derives it from the private
// `config` object, not from the instance field. Mutating `config` directly
// (same object reference reused by every clone) is what actually sticks.
// Not exposed via GetLocalAgentsOptions, so this is the only integration
// point available. Centralized here as the single place that reaches into
// MastraAgent's private config, rather than an inline cast at the call site.
interface MastraAgentConfigShape {
  config: { useProcessedFinalText?: boolean };
}

const enableProcessedFinalText = (agent: MastraAgent): void => {
  agent.useProcessedFinalText = true;
  (agent as unknown as MastraAgentConfigShape).config.useProcessedFinalText = true;
};

/**
 * Every local Mastra agent, keyed by name — what the web route mounts.
 *
 * Unlike the HTTP-backed starters there is no agent server here: the agents run
 * in this process.
 */
export const createLocalAgents = (
  resourceId: string
): Record<string, AbstractAgent> => {
  patchMastraAgentRunOnce();

  const agents = MastraAgent.getLocalAgents({ mastra, resourceId }) as Record<
    string,
    AbstractAgent
  >;

  // Only the coach carries guardrails and needs processor-rewritten output
  // (see regulatedAdviceOutputGuardrail) rather than raw streamed text.
  const coach = agents.coach;
  if (coach instanceof MastraAgent) {
    enableProcessedFinalText(coach);
  }

  return agents;
};
