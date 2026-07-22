import "dotenv/config"
import * as readline from "readline"
import { agent as mastraAgent } from "./agent"
import { customAgent } from "./customAgent"
import { randomUUID } from "@ag-ui/client"
import { openUrlTool, launchUrl } from "./urlLauncher"
import { calculatorTool, evaluateExpression } from "./calculator"
import { initialSessionState, type SessionState } from "./state/sessionState"
import { formatWeatherResult, formatWeatherSummary, isWeatherToolName } from "./ui/weatherCard"

// Set AGENT_IMPL=custom to run the hand-built AbstractAgent subclass
// (src/customAgent.ts) instead of the default MastraAgent-based one
// (src/agent.ts). Both expose the same runAgent()/messages surface, so the
// chat loop below works unmodified either way.
const agent = process.env.AGENT_IMPL === "custom" ? customAgent : mastraAgent

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const MAX_TOOL_ROUNDS = 5

function askConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

/**
 * Pretty-prints the synced session state so the effect of each
 * STATE_SNAPSHOT / STATE_DELTA / setState call is visible on screen. This is
 * the "frontend" side of the watch: it always reflects `agent.state` as of
 * the most recent `onStateChanged` callback.
 */
/**
 * Client-side counterpart of the backend's STATE_DELTA: these tools run
 * here (not in customAgent.ts), so this is where their effect gets recorded
 * into shared state. `setState` is a full local replace; the next run's
 * STATE_SNAPSHOT will echo it straight back from `input.state`, closing the
 * sync loop.
 */
function appendToState<K extends "calculations" | "openedUrls">(field: K, value: SessionState[K][number]) {
  const current = (agent.state as SessionState | undefined) ?? initialSessionState
  agent.setState({
    ...current,
    [field]: [...current[field], value],
    lastUpdated: new Date().toISOString(),
  } satisfies SessionState)
}

function renderDashboard(state: SessionState) {
  const lastWeather = state.weatherLookups.at(-1)
  const lastCalc = state.calculations.at(-1)
  const lastWeatherSummary = lastWeather ? formatWeatherSummary(lastWeather.summary) : null
  console.log("📊 Session state:", {
    messageCount: state.messageCount,
    lastWeather: lastWeather ? `${lastWeatherSummary ?? lastWeather.location} (${lastWeather.at})` : null,
    lastCalculation: lastCalc ? `${lastCalc.expression} = ${lastCalc.result}` : null,
    openedUrls: state.openedUrls.length,
    lastUpdated: state.lastUpdated,
  })
}

async function chatLoop() {
  console.log("🤖 AG-UI Assistant started!")
  console.log("Type your messages and press Enter. Press Ctrl+D to quit.\n")
  // Show the state both sides agree on before any run has happened.
  renderDashboard((agent.state as SessionState | undefined) ?? initialSessionState)

  return new Promise<void>((resolve) => {
    const promptUser = () => {
      rl.question("> ", async (input) => {
        if (input.trim() === "") {
          promptUser()
          return
        }
        console.log("")

        // Pause input while processing
        rl.pause()

        // Add user message to conversation
        agent.messages.push({
          id: randomUUID(),
          role: "user",
          content: input.trim(),
        })

        try {
          // Run the agent, looping to resolve any client-side tool calls
          // (e.g. openUrl) before yielding control back to the user.
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const pendingToolCalls: {
              toolCallName: string
              toolCallId: string
              args: any
            }[] = []

            // Run the agent with event handlers
            await agent.runAgent(
              { tools: [openUrlTool, calculatorTool] },
              {
                onTextMessageStartEvent() {
                  process.stdout.write("🤖 Assistant: ")
                },
                onTextMessageContentEvent({ event }) {
                  process.stdout.write(event.delta)
                },
                onTextMessageEndEvent() {
                  console.log("\n")
                },
                onToolCallStartEvent({ event }) {
                  if (isWeatherToolName(event.toolCallName)) {
                    console.log("🌤️  Looking up weather...")
                  } else {
                    console.log("🔧 Tool call:", event.toolCallName)
                  }
                },
                onToolCallArgsEvent({ event }) {
                  process.stdout.write(event.delta)
                },
                onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
                  console.log("")
                  if (toolCallName === "openUrl" || toolCallName === "calculate") {
                    pendingToolCalls.push({
                      toolCallName,
                      toolCallId: event.toolCallId,
                      args: toolCallArgs,
                    })
                  }
                },
                onToolCallResultEvent({ event }) {
                  if (!event.content) return
                  const weatherCard = formatWeatherResult(event.content)
                  if (weatherCard) {
                    console.log(weatherCard)
                  } else {
                    console.log("🔍 Tool call result:", event.content)
                  }
                },
                // --- state sync watch ---
                // STATE_SNAPSHOT: a full replace, sent at the top of every
                // run to (re)hydrate agent.state from a known-good object.
                onStateSnapshotEvent({ event }) {
                  console.log("📦 state snapshot received")
                },
                // STATE_DELTA: an incremental JSON Patch, applied onto
                // agent.state by the SDK -- we just observe the raw ops here.
                onStateDeltaEvent({ event }) {
                  console.log("🔀 state delta:", JSON.stringify(event.delta))
                },
                // Fires after either event above has been applied (or after
                // a local agent.setState() call). This is the frontend's
                // single source of truth for "what does state look like now".
                onStateChanged({ state }) {
                  renderDashboard(state as SessionState)
                },
              }
            )

            if (pendingToolCalls.length === 0) {
              break
            }

            // Resolve each pending tool call locally, then feed the
            // result back to the model as a tool message.
            rl.resume()
            for (const { toolCallName, toolCallId, args } of pendingToolCalls) {
              let content: string
              let toolError: string | undefined
              let urlOpened = false

              if (toolCallName === "openUrl") {
                const url = args?.url
                const confirmed = await askConfirm(`Open ${url} ? [y/N] `)
                if (!confirmed) {
                  content = "User declined to open the URL."
                } else {
                  const result = await launchUrl(url)
                  content = result.message
                  if (!result.ok) {
                    toolError = result.message
                  } else {
                    urlOpened = true
                  }
                }
              } else {
                // calculate: pure computation, no confirmation needed
                const result = evaluateExpression(args?.expression)
                content = result.message
                if (!result.ok) {
                  toolError = result.message
                }
              }

              agent.messages.push({
                id: randomUUID(),
                role: "tool",
                toolCallId,
                content,
                ...(toolError ? { error: toolError } : {}),
              })

              if (!toolError) {
                if (toolCallName === "calculate") {
                  appendToState("calculations", { expression: args?.expression, result: content, at: new Date().toISOString() })
                } else if (toolCallName === "openUrl" && urlOpened) {
                  appendToState("openedUrls", args?.url)
                }
              }
            }
            rl.pause()
          }
        } catch (error) {
          console.error("❌ Error:", error)
        }

        // Resume input
        rl.resume()
        promptUser()
      })
    }

    // Handle Ctrl+D to quit
    rl.on("close", () => {
      console.log("\n👋 Thanks for using AG-UI Assistant!")
      resolve()
    })

    promptUser()
  })
}

async function main() {
  await chatLoop()
}

main().catch(console.error)