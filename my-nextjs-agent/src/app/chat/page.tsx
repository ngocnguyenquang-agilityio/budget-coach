'use client'

import '@/app/globals.css'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DefaultChatTransport, ToolUIPart, type UIMessage } from 'ai'
import { useChat } from '@ai-sdk/react'
import { AlertTriangleIcon, BotIcon, CloudSunIcon, ThermometerIcon, UserIcon } from 'lucide-react'

import { ChatSidebar, type ChatSidebarHandle } from '@/components/chat-sidebar'

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'

import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'

import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { ActivityPlanCard, type ActivityPlanMetadata, SuggestActivitiesButton, isActivityPlanMessage } from '@/components/activity-plan'
import { PlanTripButton } from '@/components/trip-plan'
import { TripPlanReviewButton } from '@/components/trip-plan-review'
import { WeatherCard, WeatherCardError, WeatherCardLoading, type WeatherCardData } from '@/components/weather-card'

const SUGGESTIONS = ['Weather in Tokyo', 'Weather in Paris', 'Weather in Berlin']

function ChatPanel({ threadId, onMessageFinished }: { threadId: string; onMessageFinished: () => void }) {
  const [input, setInput] = useState<string>('')
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyRetryToken, setHistoryRetryToken] = useState(0)

  const { messages, setMessages, sendMessage, regenerate, clearError, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { threadId },
    }),
    onFinish: onMessageFinished,
  })

  useEffect(() => {
    let cancelled = false

    const fetchMessages = async () => {
      setIsLoadingHistory(true)
      setHistoryError(null)

      try {
        const res = await fetch(`/api/chat?threadId=${threadId}`)
        if (!res.ok) throw new Error('Failed to load this conversation.')
        const data = await res.json()
        if (!cancelled) setMessages([...data])
      } catch {
        if (!cancelled) setHistoryError('Failed to load this conversation.')
      } finally {
        if (!cancelled) setIsLoadingHistory(false)
      }
    }
    fetchMessages()

    return () => {
      cancelled = true
    }
  }, [setMessages, threadId, historyRetryToken])

  const handleSubmit = async () => {
    if (!input.trim()) return

    sendMessage({ text: input })
    setInput('')
  }

  const replaceMessage = (newMessage: UIMessage) =>
    setMessages(prev => [...prev.filter(m => m.id !== newMessage.id), newMessage])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4">
      <Conversation className="h-full">
        <ConversationContent>
          {isLoadingHistory && (
            <div className="flex flex-1 items-center justify-center py-12 text-muted-foreground text-sm">
              Loading conversation...
            </div>
          )}

          {!isLoadingHistory && historyError && (
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>Couldn&apos;t load this conversation</AlertTitle>
              <AlertDescription>{historyError}</AlertDescription>
              <AlertAction>
                <Button size="sm" variant="outline" onClick={() => setHistoryRetryToken(token => token + 1)}>
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          )}

          {!isLoadingHistory && !historyError && messages.length === 0 && (
            <ConversationEmptyState>
              <div className="flex flex-col items-center gap-3">
                <div className="text-muted-foreground">
                  <CloudSunIcon className="size-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-medium text-sm">What&apos;s the weather like?</h3>
                  <p className="text-muted-foreground text-sm">
                    Ask about current conditions in any city and get activity ideas to match.
                  </p>
                </div>
                <Suggestions>
                  {SUGGESTIONS.map(suggestion => (
                    <Suggestion
                      key={suggestion}
                      suggestion={suggestion}
                      onClick={text => sendMessage({ text: `What's the weather in ${text.replace('Weather in ', '')}?` })}
                    />
                  ))}
                </Suggestions>
              </div>
            </ConversationEmptyState>
          )}

          {messages.map(message => {
            const activityPlanCity = isActivityPlanMessage(message)
              ? (message.metadata as ActivityPlanMetadata | undefined)?.city
              : undefined

            return (
              <div
                key={message.id}
                className={`flex items-start gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {message.role === 'user' ? (
                    <UserIcon className="size-4" />
                  ) : (
                    <BotIcon className="size-4" />
                  )}
                </div>

                <div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
                  {isActivityPlanMessage(message) ? (
                    <ActivityPlanCard message={message}>
                      {activityPlanCity && (
                        <div className="flex flex-wrap items-center gap-2">
                          <PlanTripButton
                            city={activityPlanCity}
                            threadId={threadId}
                            disabled={status !== 'ready'}
                            onMessage={replaceMessage}
                          />
                          <TripPlanReviewButton
                            city={activityPlanCity}
                            threadId={threadId}
                            disabled={status !== 'ready'}
                            onMessage={replaceMessage}
                          />
                        </div>
                      )}
                    </ActivityPlanCard>
                  ) : (
                    message.parts?.map((part, i) => {
                      if (part.type === 'text') {
                        return (
                          <Message key={`${message.id}-${i}`} from={message.role} className="max-w-full">
                            <MessageContent>
                              <MessageResponse>{part.text}</MessageResponse>
                            </MessageContent>
                          </Message>
                        )
                      }

                      if (part.type === 'tool-weatherTool') {
                        const toolPart = part as ToolUIPart

                        if (toolPart.state === 'output-error') {
                          return <WeatherCardError key={`${message.id}-${i}`} message={toolPart.errorText} />
                        }

                        if (toolPart.state === 'output-available' && toolPart.output) {
                          const weather = toolPart.output as WeatherCardData
                          return (
                            <WeatherCard key={`${message.id}-${i}`} data={weather}>
                              <SuggestActivitiesButton city={weather.location} threadId={threadId} onMessage={replaceMessage} />
                            </WeatherCard>
                          )
                        }

                        const input = toolPart.input as { location?: string } | undefined
                        return <WeatherCardLoading key={`${message.id}-${i}`} location={input?.location} />
                      }

                      if (part.type === 'tool-setTemperatureUnitTool') {
                        const toolPart = part as ToolUIPart

                        if (toolPart.state === 'output-error') {
                          return (
                            <div key={`${message.id}-${i}`} className="flex items-center gap-1.5 text-destructive text-xs">
                              <ThermometerIcon className="size-3.5" />
                              Failed to save temperature preference.
                            </div>
                          )
                        }

                        if (toolPart.state === 'output-available' && toolPart.output) {
                          const result = toolPart.output as { unit: 'celsius' | 'fahrenheit'; saved: boolean }
                          return (
                            <div key={`${message.id}-${i}`} className="flex items-center gap-1.5 text-muted-foreground text-xs">
                              <ThermometerIcon className="size-3.5" />
                              Saved temperature preference: {result.unit === 'fahrenheit' ? '°F' : '°C'}
                            </div>
                          )
                        }

                        return (
                          <div key={`${message.id}-${i}`} className="flex items-center gap-1.5 text-muted-foreground text-xs">
                            <ThermometerIcon className="size-3.5" />
                            Saving temperature preference...
                          </div>
                        )
                      }

                      if (part.type?.startsWith('tool-')) {
                        return (
                          <Tool key={`${message.id}-${i}`}>
                            <ToolHeader
                              type={(part as ToolUIPart).type}
                              state={(part as ToolUIPart).state || 'output-available'}
                              className="cursor-pointer"
                            />
                            <ToolContent>
                              <ToolInput input={(part as ToolUIPart).input || {}} />
                              <ToolOutput output={(part as ToolUIPart).output} errorText={(part as ToolUIPart).errorText} />
                            </ToolContent>
                          </Tool>
                        )
                      }

                      return null
                    })
                  )}
                </div>
              </div>
            )
          })}
          {error && (
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{error.message || 'The assistant failed to respond.'}</AlertDescription>
              <AlertAction className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    clearError()
                    regenerate()
                  }}
                >
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={clearError}>
                  Dismiss
                </Button>
              </AlertAction>
            </Alert>
          )}
          <ConversationScrollButton />
        </ConversationContent>
      </Conversation>

      <PromptInput onSubmit={handleSubmit} className="sticky bottom-0 border-t bg-background pt-4 pb-6">
        <PromptInputBody>
          <PromptInputTextarea
            onChange={e => setInput(e.target.value)}
            className="md:leading-10"
            value={input}
            placeholder="Type your message..."
            disabled={status !== 'ready'}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit status={status} onStop={stop} disabled={status === 'ready' && !input.trim()} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}

function Chat() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeThreadId, setActiveThreadId] = useState<string | null>(searchParams.get('thread'))
  const sidebarRef = useRef<ChatSidebarHandle>(null)

  const selectThread = (threadId: string) => {
    setActiveThreadId(threadId)
    router.replace(`/chat?thread=${threadId}`)
  }

  const handleThreadDeleted = (threadId: string) => {
    if (threadId === activeThreadId) {
      setActiveThreadId(null)
      router.replace('/chat')
    }
  }

  return (
    <div className="flex h-screen w-full bg-background">
      <ChatSidebar
        ref={sidebarRef}
        activeThreadId={activeThreadId}
        onSelectThread={selectThread}
        onNewThread={selectThread}
        onThreadDeleted={handleThreadDeleted}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b px-6 py-4">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CloudSunIcon className="size-4" />
          </div>
          <div>
            <h1 className="font-semibold text-sm">Weather Assistant</h1>
            <p className="text-muted-foreground text-xs">Ask about the weather anywhere</p>
          </div>
        </header>

        {activeThreadId ? (
          <ChatPanel
            key={activeThreadId}
            threadId={activeThreadId}
            onMessageFinished={() => sidebarRef.current?.refresh()}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <CloudSunIcon className="size-8 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">Start a new chat to ask about the weather.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Chat
