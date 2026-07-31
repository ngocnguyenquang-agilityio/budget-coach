'use client'

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { MessageSquareIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ThreadSummary = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

type ChatSidebarProps = {
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onNewThread: (threadId: string) => void
  onThreadDeleted: (threadId: string) => void
}

export type ChatSidebarHandle = {
  refresh: () => Promise<void>
}

export const ChatSidebar = forwardRef<ChatSidebarHandle, ChatSidebarProps>(function ChatSidebar(
  { activeThreadId, onSelectThread, onNewThread, onThreadDeleted },
  ref,
) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const res = await fetch('/api/threads')
    const data: ThreadSummary[] = await res.json()
    setThreads(data)
    setLoading(false)
  }

  useImperativeHandle(ref, () => ({ refresh }), [])

  useEffect(() => {
    refresh()
  }, [])

  const handleNewThread = async () => {
    const res = await fetch('/api/threads', { method: 'POST' })
    const thread: ThreadSummary = await res.json()
    setThreads(prev => [thread, ...prev])
    onNewThread(thread.id)
  }

  const handleDelete = async (threadId: string) => {
    await fetch(`/api/threads/${threadId}`, { method: 'DELETE' })
    setThreads(prev => prev.filter(thread => thread.id !== threadId))
    onThreadDeleted(threadId)
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={handleNewThread}>
          <PlusIcon />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && <p className="px-2 py-1 text-muted-foreground text-xs">Loading…</p>}

        {!loading && threads.length === 0 && (
          <p className="px-2 py-1 text-muted-foreground text-xs">No conversations yet.</p>
        )}

        {threads.map(thread => (
          <div
            key={thread.id}
            className={cn(
              'group flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer',
              thread.id === activeThreadId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
            )}
            onClick={() => onSelectThread(thread.id)}
          >
            <MessageSquareIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{thread.title ?? 'New chat'}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 group-hover:opacity-100"
              onClick={e => {
                e.stopPropagation()
                handleDelete(thread.id)
              }}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
})
