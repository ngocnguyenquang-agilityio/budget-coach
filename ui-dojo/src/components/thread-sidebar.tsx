import { useState } from "react";
import { Link } from "react-router";
import { ChevronRight, Pin, PlusIcon } from "lucide-react";
import type { StorageThreadType } from "@mastra/core/memory";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ThreadListSkeleton } from "@/components/assistant-ui/thread-list";
import { ThreadActionsMenu } from "@/components/assistant-ui/thread-actions-menu";
import { RenameThreadDialog } from "@/components/assistant-ui/rename-thread-dialog";
import { DeleteThreadDialog } from "@/components/assistant-ui/delete-thread-dialog";
import { isArchived, isPinned } from "@/lib/thread-metadata";
import { cn, newThreadLink } from "@/lib/utils";

const threadDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const getThreadDisplayTitle = (thread: StorageThreadType) => {
  const title = thread.title?.trim();
  if (title) {
    return title;
  }

  const threadDate = new Date(thread.updatedAt ?? thread.createdAt);

  if (Number.isNaN(threadDate.getTime())) {
    return "Untitled Thread";
  }

  return threadDateFormatter.format(threadDate).replace(", ", " at ");
};

const byUpdatedAtDesc = (a: StorageThreadType, b: StorageThreadType) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

export type ThreadSidebarProps = {
  /** URL root segment, e.g. "assistant-ui" or "copilot-kit". Threads link to
   *  `/${rootPath}/${agentId}/chat/${threadId}`. */
  rootPath: string;
  agentId: string;
  threads: StorageThreadType[];
  isLoading: boolean;
  threadId?: string;
  onDelete: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onTogglePin: (thread: StorageThreadType) => void;
  onToggleArchive: (thread: StorageThreadType) => void;
};

/**
 * Thread-list sidebar shared across the framework demos. Renders pinned /
 * unpinned / archived groups with per-row rename / pin / archive / delete
 * actions. Purely presentational — thread data and mutation callbacks are
 * supplied by the host page (see `useThreadManager`).
 */
export function ThreadSidebar({
  rootPath,
  agentId,
  threadId,
  threads,
  isLoading,
  onDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
}: ThreadSidebarProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [renameTarget, setRenameTarget] = useState<StorageThreadType | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<StorageThreadType | null>(
    null,
  );

  if (isLoading) {
    return <ThreadListSkeleton />;
  }

  const activeThreads = threads.filter((thread) => !isArchived(thread));
  const archivedThreads = threads
    .filter((thread) => isArchived(thread))
    .sort(byUpdatedAtDesc);

  const pinnedThreads = activeThreads
    .filter((thread) => isPinned(thread))
    .sort(byUpdatedAtDesc);
  const unpinnedThreads = activeThreads
    .filter((thread) => !isPinned(thread))
    .sort(byUpdatedAtDesc);

  const renderRow = (thread: StorageThreadType) => {
    const isActive = thread.id === threadId;
    const threadLink = `/${rootPath}/${agentId}/chat/${thread.id}`;
    const pinned = isPinned(thread);
    const archived = isArchived(thread);

    return (
      <li key={thread.id} className="flex items-center gap-2 w-full">
        <Button
          className="aui-thread-list-new rounded-lg px-2.5 py-2 justify-start hover:bg-muted data-active:bg-muted flex-1 min-w-0"
          variant="ghost"
          asChild
          data-active={isActive ? true : undefined}
        >
          <Link
            className="flex items-center min-w-0 w-full gap-1.5"
            to={threadLink}
          >
            {pinned && (
              <Pin className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{getThreadDisplayTitle(thread)}</span>
          </Link>
        </Button>
        <ThreadActionsMenu
          isPinned={pinned}
          isArchived={archived}
          onRename={() => setRenameTarget(thread)}
          onTogglePin={() => onTogglePin(thread)}
          onToggleArchive={() => onToggleArchive(thread)}
          onDelete={() => setDeleteTarget(thread)}
        />
      </li>
    );
  };

  return (
    <ol className="aui-root aui-thread-list-root flex flex-col items-stretch gap-1.5">
      <li>
        <Button
          className="aui-thread-list-new flex items-center justify-start gap-1 rounded-lg px-2.5 py-2 text-start hover:bg-muted data-active:bg-muted"
          variant="outline"
          asChild
        >
          <Link to={newThreadLink(rootPath, agentId)}>
            <PlusIcon />
            New Thread
          </Link>
        </Button>
      </li>

      {pinnedThreads.map(renderRow)}
      {unpinnedThreads.map(renderRow)}

      {archivedThreads.length > 0 && (
        <li>
          <Collapsible open={showArchived} onOpenChange={setShowArchived}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-1 px-2.5 py-2 text-muted-foreground hover:bg-muted"
              >
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 transition-transform",
                    showArchived && "rotate-90",
                  )}
                />
                Archived ({archivedThreads.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="mt-1.5 flex flex-col items-stretch gap-1.5">
                {archivedThreads.map(renderRow)}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        </li>
      )}

      <RenameThreadDialog
        open={renameTarget !== null}
        initialTitle={renameTarget ? getThreadDisplayTitle(renameTarget) : ""}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
          }
        }}
        onSave={(title) => {
          if (renameTarget) {
            onRename(renameTarget.id, title);
          }
        }}
      />

      <DeleteThreadDialog
        open={deleteTarget !== null}
        title={deleteTarget ? getThreadDisplayTitle(deleteTarget) : ""}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (deleteTarget) {
            onDelete(deleteTarget.id);
          }
        }}
      />
    </ol>
  );
}
