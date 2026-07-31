import { NextResponse } from 'next/server'
import { mastra } from '@/mastra'

export async function DELETE(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (!memory) {
    return NextResponse.json({ error: 'weather-agent has no Memory instance configured' }, { status: 500 })
  }

  await memory.deleteThread(threadId)

  return NextResponse.json({ deleted: true })
}
