"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent, useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  THREAD_LIST_PAGE_SIZE,
  UNTITLED_THREAD_LABEL,
} from "@/constants/threads";

// Replaces CopilotKit's <CopilotThreadsDrawer>, which only works with the
// Intelligence runtime (its thread list lives on CopilotKit's servers, and its
// runner can't survive serverless). This one reads Mastra's own memory tables in
// LibSQL via /api/threads, so the conversation list is durable across cold
// starts, redeploys and instance churn, and stays scoped to the browser's
// resourceId cookie.

type Thread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

const fetchThreads = async (): Promise<Thread[]> => {
  const response = await fetch("/api/threads");
  if (!response.ok) return [];

  const body = await response.json();
  return (body.threads ?? []).slice(0, THREAD_LIST_PAGE_SIZE);
};

export const ThreadsDrawer = () => {
  const configuration = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: "coach" });

  const [threads, setThreads] = useState<Thread[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const activeThreadId = configuration?.threadId;

  const refresh = useCallback(async (): Promise<Thread[]> => {
    const list = await fetchThreads();
    setThreads(list);
    return list;
  }, []);

  // Titling is a separate LLM call that takes seconds, so it never blocks the
  // list refresh — a new conversation has to appear the moment its run ends,
  // not once a title has been written. It is also retried for any thread that
  // is still untitled on mount: reloading the page aborts an in-flight title
  // request, which would otherwise strand that thread as "Untitled
  // conversation" permanently, since nothing else ever asks again.
  const attemptedTitles = useRef(new Set<string>());
  const titleUntitledThreads = useCallback(
    async (list: Thread[]) => {
      const pending = list.filter(
        (thread) => !thread.title && !attemptedTitles.current.has(thread.id),
      );
      if (pending.length === 0) return;

      // Sequential: each POST costs one model call, and stranded threads are
      // rare enough that they are not worth firing off in parallel.
      for (const thread of pending) {
        attemptedTitles.current.add(thread.id);
        await fetch(`/api/threads/${thread.id}/title`, { method: "POST" }).catch(
          () => {},
        );
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh().then(titleUntitledThreads);
  }, [refresh, titleUntitledThreads]);

  // A thread row only exists once a run has persisted it, so the list is
  // refreshed when a run finishes rather than when one starts.
  useEffect(() => {
    const subscription = agent.subscribe({
      onRunFinalized: () => {
        void refresh().then(titleUntitledThreads);
      },
    });

    return () => subscription.unsubscribe();
  }, [agent, refresh, titleUntitledThreads]);

  const handleSelect = (threadId: string) => {
    if (threadId === activeThreadId) return;
    // Drives the chat imperatively. This works only because the provider is
    // uncontrolled — setActiveThreadId is a documented no-op when a threadId
    // prop is passed to CopilotChatConfigurationProvider.
    configuration?.setActiveThreadId(threadId);
  };

  const handleRenameSubmit = async (threadId: string) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title) return;

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, title } : thread,
      ),
    );

    await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await refresh();
  };

  const handleDelete = async (threadId: string) => {
    setConfirmingDeleteId(null);
    setThreads((current) => current.filter((thread) => thread.id !== threadId));

    await fetch(`/api/threads/${threadId}`, { method: "DELETE" });

    // Deleting the open conversation would otherwise leave the chat pointing at
    // a thread that no longer exists.
    if (threadId === activeThreadId) configuration?.startNewThread();
    await refresh();
  };

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--background)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <span className="text-sm font-medium">Conversations</span>
        <Button size="sm" variant="outline" onClick={() => configuration?.startNewThread()}>
          + New
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <p className="px-2 py-4 text-xs text-[var(--muted-foreground)]">
            No conversations yet. Send a message to start one.
          </p>
        ) : (
          <ul className="space-y-1">
            {threads.map((thread) => (
              <li key={thread.id}>
                {renamingId === thread.id ? (
                  <input
                    autoFocus
                    className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => void handleRenameSubmit(thread.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleRenameSubmit(thread.id);
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded-[var(--radius)] px-2 py-1.5",
                      thread.id === activeThreadId
                        ? "bg-[var(--secondary)]"
                        : "hover:bg-[var(--secondary)]",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm"
                      onClick={() => handleSelect(thread.id)}
                    >
                      {thread.title || UNTITLED_THREAD_LABEL}
                    </button>

                    {confirmingDeleteId === thread.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDelete(thread.id)}
                        >
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmingDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() => {
                            setRenameDraft(thread.title);
                            setRenamingId(thread.id);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() => setConfirmingDeleteId(thread.id)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};
