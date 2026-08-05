import { NextResponse } from 'next/server'
import { mastra } from '@/mastra'
import { getResourceId } from '@/mastra/get-resource-id'

export async function DELETE(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (!memory) {
    return NextResponse.json({ error: 'weather-agent has no Memory instance configured' }, { status: 500 })
  }

  const thread = await memory.getThreadById({ threadId })

  if (!thread || thread.resourceId !== getResourceId(req)) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  await memory.deleteThread(threadId)

  return NextResponse.json({ deleted: true })
}
