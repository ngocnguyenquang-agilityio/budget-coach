import { useNavigate } from "react-router";
import type { StorageThreadType } from "@mastra/core/memory";
import { useMemory } from "@/hooks/use-memory";
import { useThreads } from "@/hooks/use-threads";
import { useUpdateThread } from "@/hooks/use-update-thread";
import { useDeleteThread } from "@/hooks/use-delete-thread";
import { isArchived, isPinned } from "@/lib/thread-metadata";
import { newThreadLink } from "@/lib/utils";

type UseThreadManagerInput = {
  /** URL root segment, e.g. "assistant-ui" or "copilot-kit". */
  rootPath: string;
  agentId: string;
  /** Memory resource scope the threads live under. Defaults to agentId. */
  resourceId?: string;
  /** Active thread from the route, used to redirect after deleting it. */
  threadId?: string;
};

/**
 * Shared thread-list state + CRUD wiring for the demo pages. Lists threads for
 * the given resource/agent and exposes rename / pin / archive / delete
 * handlers. Every consuming route requires `:threadId`, so callers always
 * pass a `threadId` once mounted.
 */
export const useThreadManager = ({
  rootPath,
  agentId,
  resourceId = agentId,
  threadId,
}: UseThreadManagerInput) => {
  const navigate = useNavigate();

  const { data: memory } = useMemory(agentId);
  const isMemoryEnabled = !!memory?.result;

  const {
    data: threads,
    isLoading: isThreadsLoading,
    refetch: refreshThreads,
  } = useThreads({ resourceId, agentId, isMemoryEnabled });

  const { mutateAsync: deleteThreadAsync } = useDeleteThread();
  const { mutateAsync: updateThreadAsync } = useUpdateThread();

  const handleDelete = async (deleteId: string) => {
    await deleteThreadAsync({ threadId: deleteId, agentId, resourceId });
    if (deleteId === threadId) {
      navigate(newThreadLink(rootPath, agentId));
    }
  };

  // useUpdateThread invalidates the ["memory","threads"] query on success,
  // which refetches the list — no explicit refresh needed here.
  const handleRename = async (renameId: string, title: string) => {
    await updateThreadAsync({ threadId: renameId, agentId, title });
  };

  const handleTogglePin = async (thread: StorageThreadType) => {
    await updateThreadAsync({
      threadId: thread.id,
      agentId,
      metadata: { pinned: !isPinned(thread) },
    });
  };

  const handleToggleArchive = async (thread: StorageThreadType) => {
    await updateThreadAsync({
      threadId: thread.id,
      agentId,
      metadata: { archived: !isArchived(thread) },
    });
  };

  return {
    threads: threads ?? [],
    isThreadsLoading,
    isMemoryEnabled,
    refreshThreads,
    handlers: {
      onDelete: handleDelete,
      onRename: handleRename,
      onTogglePin: handleTogglePin,
      onToggleArchive: handleToggleArchive,
    },
  };
};
