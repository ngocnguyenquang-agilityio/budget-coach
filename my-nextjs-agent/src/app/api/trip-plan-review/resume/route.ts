import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = (await req.json()) as {
    runId?: string
    decision?: 'approve' | 'revise' | 'discard'
    feedback?: string
  }
  const { runId, decision, feedback } = body

  if (!runId || !decision) {
    return NextResponse.json({ error: 'runId and decision are required' }, { status: 400 })
  }

  const workflow = mastra.getWorkflow('tripPlanReviewWorkflow')
  const run = await workflow.createRun({ runId })

  if (decision !== 'revise') {
    // Approve/discard: no further drafting happens, so no need to stream —
    // resolve the run and return the final result directly. `step` is
    // omitted: this workflow only ever has one step suspended at a time
    // (review-gate, inside the dowhile loop), so Mastra resolves it
    // automatically. If `runId` doesn't correspond to a real suspended run,
    // resume() rejects (no persisted snapshot to resume) — treat that as
    // an expired/invalid review session.
    let result
    try {
      result = await run.resume({ resumeData: { decision, feedback } })
    } catch {
      return NextResponse.json({ error: 'Review session not found or expired' }, { status: 404 })
    }
    if (result.status !== 'success') {
      return NextResponse.json({ error: `Unexpected workflow status: ${result.status}` }, { status: 500 })
    }
    return NextResponse.json(result.result)
  }

  // Revise: stream the newly-drafted itinerary the same way the start route
  // does. Unlike the approve/discard branch above, `resumeStream()` starts
  // producing its event stream immediately and synchronously (it doesn't
  // return a Promise), so an invalid/expired `runId` can't be detected
  // up front here with a clean 404 — a failure instead surfaces once the
  // stream is consumed below, which propagates as a normal stream error to
  // the client (same generic error handling every other route in this app
  // relies on for mid-stream failures).
  const messageId = crypto.randomUUID()
  const runOutput = run.resumeStream({ resumeData: { decision, feedback } })

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
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
        throw new Error(`Expected trip-plan-review workflow to suspend again after revise, got status: ${result.status}`)
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
