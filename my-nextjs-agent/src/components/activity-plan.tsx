'use client'

import { useState } from 'react'
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai'
import { Loader2Icon, SparklesIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MessageResponse } from '@/components/ai-elements/message'

export type ActivityPlanMetadata = { kind: 'activity-plan' }

export function isActivityPlanMessage(message: UIMessage): boolean {
  const metadata = message.metadata as ActivityPlanMetadata | undefined
  if (metadata?.kind === 'activity-plan') return true

  if (message.role !== 'assistant') return false

  const text = message.parts
    ?.filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('')
    .trim()

  return Boolean(text?.startsWith('📅'))
}

function getMessageText(message: UIMessage): string {
  return (
    message.parts
      ?.filter(part => part.type === 'text')
      .map(part => (part as { text: string }).text)
      .join('') ?? ''
  )
}

export function ActivityPlanCard({ message }: { message: UIMessage }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
        <SparklesIcon className="size-3.5" />
        Activity Plan
      </div>
      <MessageResponse>{getMessageText(message)}</MessageResponse>
    </div>
  )
}

export function SuggestActivitiesButton({
  city,
  threadId,
  onMessage,
}: {
  city: string
  threadId: string
  onMessage: (message: UIMessage) => void
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  const handleClick = async () => {
    setStatus('loading')

    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, threadId }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Failed to generate activity plan')
      }

      const chunkStream = parseJsonEventStream({
        stream: res.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream<{ success: boolean; value?: UIMessageChunk; error?: unknown }, UIMessageChunk>({
          transform(chunk, controller) {
            if (!chunk.success || !chunk.value) {
              controller.error(chunk.error ?? new Error('Invalid activity plan stream chunk'))
              return
            }
            controller.enqueue(chunk.value)
          },
        })
      )

      for await (const message of readUIMessageStream({ stream: chunkStream })) {
        onMessage({ ...message, metadata: { kind: 'activity-plan' } as ActivityPlanMetadata })
      }

      setStatus('idle')
    } catch (error) {
      console.error('Failed to suggest activities', error)
      setStatus('error')
    }
  }

  return (
    <Button size="sm" variant="outline" className="gap-1.5" disabled={status === 'loading'} onClick={handleClick}>
      {status === 'loading' ? <Loader2Icon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5" />}
      {status === 'error' ? 'Try again' : 'Suggest activities'}
    </Button>
  )
}
