import { AbstractAgent, randomUUID } from "@ag-ui/client"
import type { AgentConfig } from "@ag-ui/client"
import { EventType } from "@ag-ui/core"
import type { BaseEvent, Message, RunAgentInput, Tool as AGUITool } from "@ag-ui/core"
import { Observable } from "rxjs"
import OpenAI from "openai"
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions"
import { weatherTool } from "./tools/weather.tool"
import { diffSessionState, initialSessionState, type SessionState } from "./state/sessionState"

/**
 * A from-scratch AG-UI agent.
 *
 * Unlike `MastraAgent` (see ./agent.ts), which hides the AG-UI streaming
 * protocol behind typed event callbacks, this agent implements `run()`
 * itself: it calls OpenAI's streaming chat-completions API directly and
 * hand-translates every chunk into AG-UI protocol events
 * (RUN_STARTED -> TEXT_MESSAGE_* -> TOOL_CALL_* -> RUN_FINISHED). The point
 * is to see exactly what MastraAgent does for us normally.
 *
 * The `weather` tool is executed in-process (server-side), the same as it
 * is for MastraAgent. The `calculate` / `openUrl` client-side tools are
 * *not* executed here -- their TOOL_CALL_* events are emitted and then
 * control is handed back to the caller (src/index.ts), which resolves them
 * locally and re-runs the agent, exactly like it does today.
 *
 * It also demonstrates AG-UI's shared-state sync (see src/state/sessionState.ts
 * and docs/state-sync.md): a STATE_SNAPSHOT is emitted at the top of every
 * run to (re)hydrate `agent.state` from whatever the client last sent in,
 * and a STATE_DELTA (JSON Patch) is emitted whenever the server-side weather
 * tool resolves. The client mirrors this with its own `setState` calls for
 * client-side tools -- see src/index.ts.
 */

const MAX_INTERNAL_ROUNDS = 5
const WEATHER_FUNCTION_NAME = "get_weather"

const weatherFunctionTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: WEATHER_FUNCTION_NAME,
    description: weatherTool.description,
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
      },
      required: ["location"],
    },
  },
}

interface PendingToolCall {
  id: string
  name: string
  argsText: string
}

export interface CustomStreamingAgentConfig extends AgentConfig {
  /** System instructions prepended to every OpenAI call. */
  instructions: string
  model?: string
  apiKey?: string
}

export class CustomStreamingAgent extends AbstractAgent {
  private readonly openai: OpenAI
  private readonly instructions: string
  private readonly model: string

  constructor(config: CustomStreamingAgentConfig) {
    const { instructions, model, apiKey, ...rest } = config
    super(rest)
    this.instructions = instructions
    this.model = model ?? "gpt-4o"
    this.openai = new OpenAI({ apiKey })
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false
      const emit = (event: BaseEvent) => {
        if (!cancelled) subscriber.next(event)
      }

      const execute = async () => {
        emit({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as BaseEvent)

        // Re-sync full state at the top of every run: whatever the client
        // sent in as `input.state` (echoing back its own last mutation) is
        // taken as the source of truth, with lastUpdated bumped here on the
        // backend. This is the STATE_SNAPSHOT half of sync -- a full
        // replace, used to (re)hydrate both sides from a single, known-good
        // object rather than assuming prior deltas landed cleanly.
        //
        // messageCount only counts real user turns. run() is re-entered for
        // client-tool round-trips too (index.ts pushes a "tool" message and
        // calls runAgent() again before the user types anything else), so
        // we only bump the count when the input actually ends in a fresh
        // user message.
        const incomingState = (input.state as SessionState | undefined) ?? initialSessionState
        const isNewUserTurn = input.messages.at(-1)?.role === "user"
        const nowIso = new Date().toISOString()
        let currentState: SessionState = {
          ...incomingState,
          messageCount: isNewUserTurn ? incomingState.messageCount + 1 : incomingState.messageCount,
          lastUpdated: nowIso,
        }
        emit({ type: EventType.STATE_SNAPSHOT, snapshot: currentState } as BaseEvent)

        try {
          const tools = this.buildOpenAiTools(input.tools)
          const workingMessages = this.buildOpenAiMessages(input.messages)

          for (let round = 0; round < MAX_INTERNAL_ROUNDS; round++) {
            if (cancelled) return
            const toolCalls = await this.streamOneTurn(workingMessages, tools, emit)

            if (toolCalls.length === 0) {
              break
            }

            workingMessages.push({
              role: "assistant",
              content: null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.argsText },
              })),
            })

            // Weather calls are resolved in-process regardless of what else
            // is in this batch -- every TOOL_CALL_START we emitted needs a
            // matching TOOL_CALL_RESULT, or the next OpenAI request (which
            // resends this history) gets rejected for an unanswered
            // tool_call. Any non-weather (client-side) call is left for the
            // caller to resolve, mirroring the existing chat-loop contract.
            const weatherCalls = toolCalls.filter((tc) => tc.name === WEATHER_FUNCTION_NAME)
            const hasClientToolCall = toolCalls.some((tc) => tc.name !== WEATHER_FUNCTION_NAME)

            for (const call of weatherCalls) {
              if (cancelled) return
              const resultContent = await this.executeWeatherTool(call.argsText)
              emit({
                type: EventType.TOOL_CALL_RESULT,
                messageId: randomUUID(),
                toolCallId: call.id,
                content: resultContent,
              } as BaseEvent)
              workingMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: resultContent,
              })

              let location: string | undefined
              try {
                location = (JSON.parse(call.argsText || "{}") as { location?: string }).location
              } catch (error) {
                console.error("Failed to parse weather tool call arguments:", call.argsText, error)
              }

              // Incremental half of sync: rather than re-sending the whole
              // state, diff the before/after snapshots into a JSON Patch
              // and ship just that. The SDK applies this onto `agent.state`
              // for us; the frontend observes it via onStateDeltaEvent.
              const at = new Date().toISOString()
              const nextState: SessionState = {
                ...currentState,
                weatherLookups: [
                  ...currentState.weatherLookups,
                  { location: location ?? "unknown", summary: resultContent, at },
                ],
                lastUpdated: at,
              }
              const delta = diffSessionState(currentState, nextState)
              if (delta.length > 0) {
                emit({ type: EventType.STATE_DELTA, delta } as BaseEvent)
              }
              currentState = nextState
            }

            if (hasClientToolCall) {
              break
            }
            // loop again so the model streams its final answer using the
            // weather result we just appended
          }

          emit({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent)
          subscriber.complete()
        } catch (error) {
          emit({
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : String(error),
          } as BaseEvent)
          subscriber.error(error)
        }
      }

      execute()

      return () => {
        cancelled = true
      }
    })
  }

  /**
   * Streams a single OpenAI chat-completion turn, manually converting each
   * chunk into AG-UI TEXT_MESSAGE_* / TOOL_CALL_* events. Returns any tool
   * calls the model made during this turn (empty if it just replied with
   * text).
   */
  private async streamOneTurn(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    emit: (event: BaseEvent) => void
  ): Promise<PendingToolCall[]> {
    const stream = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
    })

    let textMessageId: string | null = null
    let assistantText = ""
    // Accumulate streamed tool-call fragments by their index in the delta
    // array -- OpenAI sends the id/name on the first fragment and the
    // arguments spread across many subsequent fragments.
    const callsByIndex = new Map<number, PendingToolCall>()
    const callOrder: number[] = []

    for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta

      if (delta?.content) {
        if (textMessageId === null) {
          textMessageId = randomUUID()
          emit({
            type: EventType.TEXT_MESSAGE_START,
            messageId: textMessageId,
            role: "assistant",
          } as BaseEvent)
        }
        assistantText += delta.content
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: textMessageId,
          delta: delta.content,
        } as BaseEvent)
      }

      if (delta?.tool_calls) {
        for (const fragment of delta.tool_calls) {
          const index = fragment.index
          let call = callsByIndex.get(index)
          if (!call) {
            call = {
              id: fragment.id ?? randomUUID(),
              name: fragment.function?.name ?? "",
              argsText: "",
            }
            callsByIndex.set(index, call)
            callOrder.push(index)
            emit({
              type: EventType.TOOL_CALL_START,
              toolCallId: call.id,
              toolCallName: call.name,
            } as BaseEvent)
          }
          if (fragment.function?.arguments) {
            call.argsText += fragment.function.arguments
            emit({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: call.id,
              delta: fragment.function.arguments,
            } as BaseEvent)
          }
        }
      }
    }

    if (textMessageId !== null) {
      emit({ type: EventType.TEXT_MESSAGE_END, messageId: textMessageId } as BaseEvent)
    }

    const toolCalls = callOrder.map((index) => callsByIndex.get(index)!)
    for (const call of toolCalls) {
      emit({ type: EventType.TOOL_CALL_END, toolCallId: call.id } as BaseEvent)
    }

    return toolCalls
  }

  /** Executes the weather tool in-process (server-side), like MastraAgent does. */
  private async executeWeatherTool(argsText: string): Promise<string> {
    try {
      const args = JSON.parse(argsText || "{}") as { location?: string }
      if (!args.location) {
        return "Error: no location provided."
      }
      const result = await weatherTool.execute!({ location: args.location } as any, {} as any)
      return JSON.stringify(result)
    } catch (error) {
      return `Error fetching weather: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private buildOpenAiTools(inputTools: AGUITool[] | undefined): ChatCompletionTool[] {
    const clientTools: ChatCompletionTool[] = (inputTools ?? []).map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? { type: "object", properties: {} },
      },
    }))
    return [weatherFunctionTool, ...clientTools]
  }

  private buildOpenAiMessages(messages: Message[]): ChatCompletionMessageParam[] {
    const converted: ChatCompletionMessageParam[] = messages.map((message) => {
      switch (message.role) {
        case "developer":
        case "system":
          return { role: "system", content: message.content }
        case "user":
          return {
            role: "user",
            content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
          }
        case "assistant":
          return {
            role: "assistant",
            content: message.content ?? null,
            ...(message.toolCalls
              ? {
                  tool_calls: message.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: tc.function,
                  })),
                }
              : {}),
          }
        case "tool":
          return {
            role: "tool",
            tool_call_id: message.toolCallId,
            content: message.error ? `Error: ${message.error}` : message.content,
          }
        default:
          // "activity" and any future roles: skip, OpenAI has no equivalent.
          return { role: "system", content: "" }
      }
    })

    return [{ role: "system", content: this.instructions }, ...converted]
  }
}

/**
 * Singleton instance mirroring `agent` from ./agent.ts, so src/index.ts can
 * pick between the two implementations via a single import swap.
 */
export const customAgent = new CustomStreamingAgent({
  threadId: "main-conversation",
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
  initialState: initialSessionState,
  instructions: `
    You are a helpful AI assistant. Be friendly, conversational, and helpful.
    Answer questions to the best of your ability and engage in natural conversation.

    For weather queries:
    - Always ask for a location if none is provided
    - Use the get_weather tool to fetch current weather data

    If the user asks you to open a link or visit a website, use the "openUrl" tool
    to open it in their default web browser. Always use full URLs (e.g., "https://www.google.com").
  `,
})
