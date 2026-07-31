import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = (await req.json()) as { city?: string; days?: number; threadId?: string }
  const { city, days, threadId } = body

  if (!city || !days || !threadId) {
    return NextResponse.json({ error: 'city, days, and threadId are required' }, { status: 400 })
  }

  const messageId = crypto.randomUUID()

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const workflow = mastra.getWorkflow('tripPlanReviewWorkflow')
      const run = await workflow.createRun()
      const runOutput = run.stream({ inputData: { city, days, threadId } })

      writer.write({ type: 'start', messageId })
      writer.write({ type: 'text-start', id: messageId })

      for await (const event of runOutput.fullStream) {
        if (event.type !== 'workflow-step-output') continue
        const output = event.payload.output as { type?: string; payload?: { text?: string } } | undefined
        if (output?.type === 'text-delta' && typeof output.payload?.text === 'string') {
          writer.write({ type: 'text-delta', id: messageId, delta: output.payload.text })
        }
      }

      writer.write({ type: 'text-end', id: messageId })

      const result = await runOutput.result
      if (result.status !== 'suspended') {
        throw new Error(`Expected trip-plan-review workflow to suspend for approval, got status: ${result.status}`)
      }

      writer.write({
        type: 'message-metadata',
        messageMetadata: { runId: run.runId, status: 'suspended' },
      })
      writer.write({ type: 'finish' })
    },
  })

  return createUIMessageStreamResponse({ stream })
}
