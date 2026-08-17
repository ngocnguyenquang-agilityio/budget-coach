import {
  InMemoryAgentRunner,
  type AgentRunnerConnectRequest,
} from "@copilotkit/runtime/v2";
import { EventType, type BaseEvent, type Message } from "@ag-ui/client";
import { Observable, defer, from, switchMap } from "rxjs";
import { randomUUID } from "node:crypto";
import { mastra } from "@/mastra";
import { storage } from "@/mastra/storage";
import { mastraToAGUIMessages } from "@/lib/mastra-to-agui-messages";
import { BudgetStateSchema } from "@/domain/budget-state";
import type { MastraStoredMessage } from "@/lib/mastra-to-agui-messages";

// Re-opening a thread has to rebuild its transcript from somewhere. The stock
// InMemoryAgentRunner replays from a module-scope Map, which on Vercel belongs to
// one lambda instance — a cold instance shows an empty conversation. This runner
// falls back to Mastra's own memory in LibSQL, so history survives cold starts,
// redeploys and instance churn.
//
// This runs inside the /connect request rather than after it: no work is left
// running once the response returns, which is exactly the constraint that made
// the Intelligence runner unusable here.

const RESOURCE_ID_HEADER = "x-resource-id";

const runStarted = (threadId: string, runId: string): BaseEvent =>
  ({ type: EventType.RUN_STARTED, threadId, runId }) as BaseEvent;

const runFinished = (threadId: string, runId: string): BaseEvent =>
  ({ type: EventType.RUN_FINISHED, threadId, runId }) as BaseEvent;

const messagesSnapshot = (messages: Message[]): BaseEvent =>
  ({ type: EventType.MESSAGES_SNAPSHOT, messages }) as BaseEvent;

const stateSnapshot = (snapshot: unknown): BaseEvent =>
  ({ type: EventType.STATE_SNAPSHOT, snapshot }) as BaseEvent;

// Mirrors src/app/api/working-memory/route.ts. Replayed alongside the messages
// because CopilotKit clears agent.state on every reconnect, and the Dashboard
// only re-fetches when the agent identity changes — which switching threads is not.
const readWorkingMemory = async (resourceId: string): Promise<unknown> => {
  const memoryStore = await storage.getStore("memory");
  const resource = await memoryStore?.getResourceById({ resourceId });
  if (!resource?.workingMemory) return {};

  try {
    const parsed = BudgetStateSchema.safeParse(JSON.parse(resource.workingMemory));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
};

const replayFromMastra = async (
  threadId: string,
  resourceId: string | undefined,
): Promise<BaseEvent[]> => {
  const runId = randomUUID();
  const events: BaseEvent[] = [runStarted(threadId, runId)];

  // "coach" is the Mastra registration key, not the agent's id — the key is what
  // identifies an agent everywhere in this app.
  const memory = await mastra.getAgent("coach").getMemory();
  const thread = memory ? await memory.getThreadById({ threadId }) : null;

  // Ownership is enforced here, not just in the UI: a thread id is guessable, and
  // /connect would otherwise hand any browser another browser's conversation.
  if (!memory || !thread || !resourceId || thread.resourceId !== resourceId) {
    events.push(runFinished(threadId, runId));
    return events;
  }

  const { messages } = await memory.recall({ threadId, resourceId });

  events.push(
    messagesSnapshot(
      mastraToAGUIMessages(messages as unknown as MastraStoredMessage[]),
    ),
  );
  events.push(stateSnapshot(await readWorkingMemory(resourceId)));
  events.push(runFinished(threadId, runId));

  return events;
};

export class MastraReplayAgentRunner extends InMemoryAgentRunner {
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    // A warm instance that already holds this thread's events replays them
    // verbatim, and a live run keeps streaming — both are the stock, well-tested
    // path. Only a cold instance pays for the database read.
    if (this.getThreadEvents(request.threadId).length > 0) {
      return super.connect(request);
    }

    const resourceId = request.headers?.[RESOURCE_ID_HEADER];

    return defer(() =>
      from(replayFromMastra(request.threadId, resourceId)).pipe(
        switchMap((events) => from(events)),
      ),
    );
  }
}
