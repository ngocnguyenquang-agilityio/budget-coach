import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { RESOURCE_ID } from '@/mastra/constants'
import { NextResponse } from 'next/server'

const CHUNK_SIZE = 40
const CHUNK_DELAY_MS = 15

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

async function runActivityWorkflow(city: string): Promise<string> {
  const workflow = mastra.getWorkflow('weatherWorkflow')
  const run = await workflow.createRun()
  const result = await run.start({ inputData: { city } })

  if (result.status !== 'success') {
    throw new Error(`Activity workflow did not complete successfully (status: ${result.status})`)
  }

  return result.result.activities
}

async function persistActivityPlan(threadId: string, messageId: string, text: string) {
  const memory = await mastra.getAgentById('weather-agent').getMemory()
  if (!memory) return

  await memory.saveMessages({
    messages: [
      {
        id: messageId,
        role: 'assistant',
        createdAt: new Date(),
        threadId,
        resourceId: RESOURCE_ID,
        content: {
          format: 2,
          parts: [{ type: 'text', text }],
        },
      },
    ],
  })
}

export async function POST(req: Request) {
  const body = (await req.json()) as { city?: string; threadId?: string }
  const { city, threadId } = body

  if (!city || !threadId) {
    return NextResponse.json({ error: 'city and threadId are required' }, { status: 400 })
  }

  const messageId = crypto.randomUUID()

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const text = await runActivityWorkflow(city)

      writer.write({ type: 'start', messageId })
      writer.write({ type: 'text-start', id: messageId })

      for (const chunk of splitIntoChunks(text, CHUNK_SIZE)) {
        writer.write({ type: 'text-delta', id: messageId, delta: chunk })
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS))
      }

      writer.write({ type: 'text-end', id: messageId })
      writer.write({ type: 'finish' })

      await persistActivityPlan(threadId, messageId, text)
    },
  })

  return createUIMessageStreamResponse({ stream })
}
