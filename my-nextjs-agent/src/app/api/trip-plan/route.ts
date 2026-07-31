import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { RESOURCE_ID } from '@/mastra/constants'
import { NextResponse } from 'next/server'

async function persistTripPlan(threadId: string, messageId: string, text: string) {
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
  const body = (await req.json()) as { city?: string; days?: number; threadId?: string }
  const { city, days, threadId } = body

  if (!city || !days || !threadId) {
    return NextResponse.json({ error: 'city, days, and threadId are required' }, { status: 400 })
  }

  const messageId = crypto.randomUUID()

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const tripPlannerAgent = mastra.getAgentById('trip-planner-agent')

      const response = await tripPlannerAgent.stream([
        {
          role: 'user',
          content: `Plan a ${days}-day trip to ${city}.`,
        },
      ])

      writer.write({ type: 'start', messageId })
      writer.write({ type: 'text-start', id: messageId })

      let text = ''
      for await (const chunk of response.textStream) {
        text += chunk
        writer.write({ type: 'text-delta', id: messageId, delta: chunk })
      }

      writer.write({ type: 'text-end', id: messageId })
      writer.write({ type: 'finish' })

      await persistTripPlan(threadId, messageId, text)
    },
  })

  return createUIMessageStreamResponse({ stream })
}
