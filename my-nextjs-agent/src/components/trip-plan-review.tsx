'use client'

import { useState } from 'react'
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai'
import { Loader2Icon, MapIcon, CheckIcon, XIcon, PencilIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MessageResponse } from '@/components/ai-elements/message'
import { type TripPlanMetadata } from '@/components/trip-plan'

type ReviewStatus = 'idle' | 'selecting' | 'drafting' | 'suspended' | 'revising' | 'submitting' | 'discarded' | 'expired' | 'error'

async function consumeUiMessageStream(res: Response, onDelta: (text: string) => void): Promise<UIMessage> {
  if (!res.ok || !res.body) {
    throw new Error('Trip plan review request failed')
  }

  const chunkStream = parseJsonEventStream({
    stream: res.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<{ success: boolean; value?: UIMessageChunk; error?: unknown }, UIMessageChunk>({
      transform(chunk, controller) {
        if (!chunk.success || !chunk.value) {
          controller.error(chunk.error ?? new Error('Invalid trip plan review stream chunk'))
          return
        }
        controller.enqueue(chunk.value)
      },
    })
  )

  let last: UIMessage | undefined
  for await (const message of readUIMessageStream({ stream: chunkStream })) {
    last = message
    const text = message.parts
      ?.filter(part => part.type === 'text')
      .map(part => (part as { text: string }).text)
      .join('') ?? ''
    onDelta(text)
  }

  if (!last) {
    throw new Error('Trip plan review stream ended with no message')
  }
  return last
}

export function TripPlanReviewCard({
  itinerary,
  status,
  feedback,
  disabled,
  onApprove,
  onStartRevising,
  onRequestChanges,
  onDiscard,
  onStartOver,
}: {
  itinerary: string
  status: ReviewStatus
  feedback: string
  disabled?: boolean
  onApprove: () => void
  onStartRevising: () => void
  onRequestChanges: (feedback: string) => void
  onDiscard: () => void
  onStartOver: () => void
}) {
  const [feedbackDraft, setFeedbackDraft] = useState('')
  const controlsDisabled = disabled || status === 'submitting' || status === 'drafting'

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
        <MapIcon className="size-3.5" />
        Trip Itinerary {status === 'suspended' || status === 'revising' ? '(draft — awaiting review)' : ''}
        {status === 'discarded' ? '(discarded)' : ''}
      </div>
      <MessageResponse>{itinerary}</MessageResponse>

      {status === 'expired' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          This review session expired —{' '}
          <Button size="sm" variant="outline" onClick={onStartOver}>
            start again
          </Button>
        </div>
      )}

      {(status === 'suspended' || status === 'revising' || status === 'submitting') && status !== 'expired' && (
        <div className="space-y-2 pt-1">
          {status === 'revising' ? (
            <div className="flex items-center gap-2">
              <Textarea
                value={feedbackDraft}
                disabled={controlsDisabled}
                onChange={e => setFeedbackDraft(e.target.value)}
                placeholder="What should change?"
                className="min-h-16"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={controlsDisabled || !feedbackDraft.trim()}
                onClick={() => onRequestChanges(feedbackDraft)}
              >
                {status === 'submitting' ? <Loader2Icon className="size-3.5 animate-spin" /> : 'Send'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" disabled={controlsDisabled} onClick={onApprove}>
                {status === 'submitting' ? <Loader2Icon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={controlsDisabled}
                onClick={() => {
                  setFeedbackDraft(feedback)
                  onStartRevising()
                }}
              >
                <PencilIcon className="size-3.5" />
                Request changes
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={controlsDisabled} onClick={onDiscard}>
                <XIcon className="size-3.5" />
                Discard
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TripPlanReviewButton({
  city,
  threadId,
  disabled,
  onMessage,
}: {
  city: string
  threadId: string
  disabled?: boolean
  onMessage: (message: UIMessage) => void
}) {
  const [status, setStatus] = useState<ReviewStatus>('idle')
  const [days, setDays] = useState(3)
  const [runId, setRunId] = useState<string | null>(null)
  const [itinerary, setItinerary] = useState('')
  const [feedback, setFeedback] = useState('')

  const startDraft = async () => {
    if (disabled) return
    setStatus('drafting')
    setItinerary('')

    try {
      const res = await fetch('/api/trip-plan-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, days, threadId }),
      })

      const message = await consumeUiMessageStream(res, setItinerary)
      const metadata = message.metadata as { runId?: string; status?: string } | undefined
      if (!metadata?.runId) throw new Error('Missing runId in trip plan review response')

      setRunId(metadata.runId)
      setStatus('suspended')
    } catch (error) {
      console.error('Failed to draft trip plan for review', error)
      setStatus('error')
    }
  }

  const resume = async (decision: 'approve' | 'revise' | 'discard', feedbackText?: string) => {
    if (!runId || disabled) return
    // 'revise' re-enters the streaming draft path (new itinerary text arrives
    // token-by-token), so it reuses 'drafting' — the same status the initial
    // draft uses to hide all review controls while text streams in. 'approve'/
    // 'discard' don't stream anything back, so they use 'submitting' instead,
    // which keeps the current draft + controls visible with a spinner.
    setStatus(decision === 'revise' ? 'drafting' : 'submitting')

    try {
      const res = await fetch('/api/trip-plan-review/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, decision, feedback: feedbackText }),
      })

      if (res.status === 404) {
        setStatus('expired')
        return
      }

      const contentType = res.headers.get('content-type') ?? ''

      if (decision === 'revise') {
        const message = await consumeUiMessageStream(res, setItinerary)
        const metadata = message.metadata as { runId?: string; status?: string } | undefined
        setRunId(metadata?.runId ?? runId)
        setStatus('suspended')
        return
      }

      if (!res.ok) throw new Error('Trip plan review resume failed')

      if (contentType.includes('application/json')) {
        const result = (await res.json()) as { itinerary?: string; status: 'saved' | 'discarded' }
        if (result.status === 'saved' && result.itinerary) {
          setItinerary(result.itinerary)
          onMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: result.itinerary }],
            metadata: { kind: 'trip-plan' } as TripPlanMetadata,
          })
          setStatus('idle')
          setRunId(null)
        } else {
          setStatus('discarded')
        }
      }
    } catch (error) {
      console.error('Failed to resume trip plan review', error)
      setStatus('error')
    }
  }

  const startOver = () => {
    setStatus('idle')
    setRunId(null)
    setItinerary('')
    setFeedback('')
  }

  if (status === 'suspended' || status === 'revising' || status === 'submitting' || status === 'drafting' || status === 'discarded' || status === 'expired') {
    return (
      <TripPlanReviewCard
        itinerary={itinerary}
        status={status}
        feedback={feedback}
        disabled={disabled}
        onApprove={() => resume('approve')}
        onStartRevising={() => setStatus('revising')}
        onRequestChanges={text => {
          setFeedback(text)
          void resume('revise', text)
        }}
        onDiscard={() => resume('discard')}
        onStartOver={startOver}
      />
    )
  }

  if (status === 'idle' || status === 'error') {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled} onClick={() => setStatus('selecting')}>
        <MapIcon className="size-3.5" />
        {status === 'error' ? 'Try again' : 'Plan my trip (with review)'}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        max={7}
        value={days}
        disabled={disabled}
        onChange={e => setDays(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
        className="w-16"
      />
      <span className="text-muted-foreground text-xs">days</span>
      <Button size="sm" variant="outline" disabled={disabled} onClick={startDraft}>
        Go
      </Button>
    </div>
  )
}
