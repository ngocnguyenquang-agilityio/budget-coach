import { NextResponse } from 'next/server'
import { mastra } from '@/mastra'

const RESOURCE_ID = 'weather-chat'

export async function GET() {
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (!memory) {
    return NextResponse.json([], { status: 200 })
  }

  const result = await memory.listThreads({
    filter: { resourceId: RESOURCE_ID },
    orderBy: { field: 'updatedAt', direction: 'DESC' },
    perPage: false,
  })

  const threads = result.threads.map(thread => ({
    id: thread.id,
    title: thread.title || null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }))

  return NextResponse.json(threads)
}

export async function POST() {
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (!memory) {
    return NextResponse.json({ error: 'weather-agent has no Memory instance configured' }, { status: 500 })
  }

  const thread = await memory.createThread({ resourceId: RESOURCE_ID })

  return NextResponse.json({
    id: thread.id,
    title: thread.title || null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  })
}
