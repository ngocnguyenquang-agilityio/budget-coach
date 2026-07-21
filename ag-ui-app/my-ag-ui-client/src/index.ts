import * as readline from "readline"
import { agent } from "./agent"
import { randomUUID } from "@ag-ui/client"
import { openUrlTool, launchUrl } from "./urlLauncher"

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

async function chatLoop() {
  console.log("🤖 AG-UI Assistant started!")
  console.log("Type your messages and press Enter. Press Ctrl+D to quit.\n")

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
            const pendingToolCalls: { toolCallId: string; args: any }[] = []

            // Run the agent with event handlers
            await agent.runAgent(
              { tools: [openUrlTool] },
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
                onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
                  if (toolCallName === "openUrl") {
                    pendingToolCalls.push({
                      toolCallId: event.toolCallId,
                      args: toolCallArgs,
                    })
                  }
                },
              }
            )

            if (pendingToolCalls.length === 0) {
              break
            }

            // Resolve each pending openUrl call locally, then feed the
            // result back to the model as a tool message.
            rl.resume()
            for (const { toolCallId, args } of pendingToolCalls) {
              const url = args?.url
              let content: string
              let toolError: string | undefined

              const confirmed = await askConfirm(`Open ${url} ? [y/N] `)
              if (!confirmed) {
                content = "User declined to open the URL."
              } else {
                const result = await launchUrl(url)
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