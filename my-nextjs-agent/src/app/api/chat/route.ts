import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import { mastra } from '@/mastra'
import { getResourceId } from '@/mastra/get-resource-id'
import { NextResponse } from 'next/server'

function extractLatestUserText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; parts?: Array<{ type?: string; text?: string }> }
    if (message?.role !== 'user') continue

    const text = message.parts
      ?.filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join(' ')
      .trim()

    if (text) return text
  }

  return null
}

function titleFromText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 40 ? `${trimmed.slice(0, 40).trimEnd()}…` : trimmed
}

export async function POST(req: Request) {
  const params = await req.json()
  const threadId: string | undefined = params.threadId

  if (!threadId) {
    return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
  }

  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (memory) {
    const thread = await memory.getThreadById({ threadId })
    if (thread && !thread.title) {
      const latestUserText = extractLatestUserText(params.messages ?? [])
      if (latestUserText) {
        await memory.updateThread({ id: threadId, title: titleFromText(latestUserText), metadata: thread.metadata ?? {} })
      }
    }
  }

  const stream = await handleChatStream({
    mastra,
    agentId: 'weather-agent',
    params: {
      ...params,
      memory: {
        ...params.memory,
        thread: threadId,
        resource: getResourceId(req),
      },
    },
  })
  return createUIMessageStreamResponse({
    stream: stream as ReadableStream<UIMessageChunk>,
  })
}

export async function GET(req: Request) {
  const threadId = new URL(req.url).searchParams.get('threadId')

  if (!threadId) {
    return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
  }

  const memory = await mastra.getAgentById('weather-agent').getMemory()
  let response = null

  try {
    response = await memory?.recall({
      threadId,
      resourceId: getResourceId(req),
    })
  } catch {
    console.log('No previous messages found.')
  }

  const uiMessages = toAISdkV5Messages(response?.messages || [])

  return NextResponse.json(uiMessages)
}