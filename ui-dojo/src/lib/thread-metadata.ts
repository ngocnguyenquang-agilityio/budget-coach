import type { StorageThreadType } from "@mastra/core/memory";

export const isArchived = (thread: StorageThreadType): boolean =>
  Boolean(thread.metadata?.archived);

export const isPinned = (thread: StorageThreadType): boolean =>
  Boolean(thread.metadata?.pinned);
