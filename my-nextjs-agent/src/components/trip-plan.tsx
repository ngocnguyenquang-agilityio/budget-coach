'use client'

import { useState } from 'react'
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai'
import { Loader2Icon, MapIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MessageResponse } from '@/components/ai-elements/message'

export type TripPlanMetadata = { kind: 'trip-plan' }

export function isTripPlanMessage(message: UIMessage): boolean {
  const metadata = message.metadata as TripPlanMetadata | undefined
  if (metadata?.kind === 'trip-plan') return true

  if (message.role !== 'assistant') return false

  const text = message.parts
    ?.filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('')
    .trim()

  return Boolean(text?.startsWith('🧳'))
}

function getMessageText(message: UIMessage): string {
  return (
    message.parts
      ?.filter(part => part.type === 'text')
      .map(part => (part as { text: string }).text)
      .join('') ?? ''
  )
}

export function TripPlanCard({ message }: { message: UIMessage }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
        <MapIcon className="size-3.5" />
        Trip Itinerary
      </div>
      <MessageResponse>{getMessageText(message)}</MessageResponse>
    </div>
  )
}

export function PlanTripButton({
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
  const [status, setStatus] = useState<'idle' | 'selecting' | 'loading' | 'error'>('idle')
  const [days, setDays] = useState(3)

  const handlePlan = async () => {
    if (disabled) return
    setStatus('loading')

    try {
      const res = await fetch('/api/trip-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, days, threadId }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Failed to generate trip plan')
      }

      const chunkStream = parseJsonEventStream({
        stream: res.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream<{ success: boolean; value?: UIMessageChunk; error?: unknown }, UIMessageChunk>({
          transform(chunk, controller) {
            if (!chunk.success || !chunk.value) {
              controller.error(chunk.error ?? new Error('Invalid trip plan stream chunk'))
              return
            }
            controller.enqueue(chunk.value)
          },
        })
      )

      for await (const message of readUIMessageStream({ stream: chunkStream })) {
        onMessage({ ...message, metadata: { kind: 'trip-plan' } as TripPlanMetadata })
      }

      setStatus('idle')
    } catch (error) {
      console.error('Failed to plan trip', error)
      setStatus('error')
    }
  }

  if (status === 'idle' || status === 'error') {
    return (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={disabled}
        onClick={() => setStatus('selecting')}
      >
        <MapIcon className="size-3.5" />
        {status === 'error' ? 'Try again' : 'Plan my trip'}
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
        disabled={status === 'loading' || disabled}
        onChange={e => setDays(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
        className="w-16"
      />
      <span className="text-muted-foreground text-xs">days</span>
      <Button size="sm" variant="outline" disabled={status === 'loading' || disabled} onClick={handlePlan}>
        {status === 'loading' ? <Loader2Icon className="size-3.5 animate-spin" /> : 'Go'}
      </Button>
    </div>
  )
}
