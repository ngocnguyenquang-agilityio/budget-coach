import {
  InMemoryAgentRunner,
  type AgentRunnerConnectRequest,
} from "@copilotkit/runtime/v2";
import { EventType, type BaseEvent, type Message } from "@ag-ui/client";
import { Observable, defer, from, switchMap } from "rxjs";
import { randomUUID } from "node:crypto";
import { mastra } from "@/mastra";
import { storage } from "@/mastra/config/storage";
import { mastraToAGUIMessages } from "@/lib/mastra-to-agui-messages";
import { BudgetStateSchema } from "@/domain/budget-state";
import type { MastraStoredMessage } from "@/lib/mastra-to-agui-messages";

// The stock InMemoryAgentRunner replays from a module-scope Map, so a cold lambda
// shows an empty conversation. This one falls back to Mastra's memory in LibSQL,
// reading it inside /connect so no work outlives the response (the constraint that
// ruled out the Intelligence runner).

const RESOURCE_ID_HEADER = "x-resource-id";

const runStarted = (threadId: string, runId: string): BaseEvent =>
  ({ type: EventType.RUN_STARTED, threadId, runId }) as BaseEvent;

const runFinished = (threadId: string, runId: string): BaseEvent =>
  ({ type: EventType.RUN_FINISHED, threadId, runId }) as BaseEvent;

const messagesSnapshot = (messages: Message[]): BaseEvent =>
  ({ type: EventType.MESSAGES_SNAPSHOT, messages }) as BaseEvent;

const stateSnapshot = (snapshot: unknown): BaseEvent =>
  ({ type: EventType.STATE_SNAPSHOT, snapshot }) as BaseEvent;

// Closes the stream cleanly for a thread with nothing to replay.
const emptyRun = (threadId: string): BaseEvent[] => {
  const runId = randomUUID();
  return [runStarted(threadId, runId), runFinished(threadId, runId)];
};

// Mirrors /api/working-memory. Replayed with the messages because CopilotKit clears
// agent.state on reconnect and the Dashboard only re-fetches per agent identity.
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

// "coach" is the Mastra registration key, not the agent's id.
const loadThread = async (threadId: string) => {
  const memory = await mastra.getAgent("coach").getMemory();
  const thread = memory ? await memory.getThreadById({ threadId }) : null;
  return { memory, thread };
};

type LoadedThread = Awaited<ReturnType<typeof loadThread>>;

const replayFromMastra = async (
  { memory, thread }: LoadedThread,
  threadId: string,
  resourceId: string | undefined,
): Promise<BaseEvent[]> => {
  if (!memory || !thread || !resourceId) return emptyRun(threadId);

  const runId = randomUUID();
  // perPage: false — the default is the Coach's lastMessages (10), which truncates.
  const { messages } = await memory.recall({
    threadId,
    resourceId,
    perPage: false,
  });

  return [
    runStarted(threadId, runId),
    messagesSnapshot(
      mastraToAGUIMessages(messages as unknown as MastraStoredMessage[]),
    ),
    stateSnapshot(await readWorkingMemory(resourceId)),
    runFinished(threadId, runId),
  ];
};

export class ThreadReplayAgentRunner extends InMemoryAgentRunner {
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const resourceId = request.headers?.[RESOURCE_ID_HEADER];

    return defer(() => loadThread(request.threadId)).pipe(
      switchMap((loaded) => {
        // Gates both paths — the warm path's event map is keyed by thread id alone
        // and shared by every user on the instance. An unpersisted thread is a first
        // run in flight: nothing to leak, and denying it would break mid-run reconnect.
        if (loaded.thread && loaded.thread.resourceId !== resourceId) {
          return from(emptyRun(request.threadId));
        }

        // Warm instance: stock replay, and a live run keeps streaming.
        if (this.getThreadEvents(request.threadId).length > 0) {
          return super.connect(request);
        }

        return from(replayFromMastra(loaded, request.threadId, resourceId)).pipe(
          switchMap((events) => from(events)),
        );
      }),
    );
  }
}
