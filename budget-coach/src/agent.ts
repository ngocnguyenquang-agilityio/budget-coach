import { randomUUID } from "node:crypto";
import { MastraAgent } from "@ag-ui/mastra";
import type { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";
import { mastra } from "@/mastra";
import { guardrailBlockChannel, type GuardrailBlockStore } from "@/mastra/guardrail-block-channel";

// Mastra's tripwire chunk (emitted when a guardrail calls abort()) is
// silently dropped by @ag-ui/mastra's chunk handler — there's no public
// event for it. So a blocked turn otherwise reaches the browser as a bare
// RUN_FINISHED with no assistant text. This wraps MastraAgent.run() to
// inject a synthetic assistant text message carrying the guardrail's
// friendly userMessage whenever a guardrail fired (via onViolation, see
// src/mastra/guardrail-block-channel.ts) but no real text was produced.
const ASSISTANT_TEXT_EVENT_TYPES: EventType[] = [
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_CHUNK,
];

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

      return guardrailBlockChannel.run(store, () => {
        const subscription = originalRun.call(this, input).subscribe({
          next: (event) => {
            if (ASSISTANT_TEXT_EVENT_TYPES.includes(event.type)) {
              store.sawAssistantText = true;
            }

            const isTerminal = event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
            if (isTerminal && store.userMessage && !store.sawAssistantText) {
              const messageId = randomUUID();
              subscriber.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
              subscriber.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: store.userMessage } as BaseEvent);
              subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
            }

            subscriber.next(event);
          },
          error: (err) => subscriber.error(err),
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
