import { useMastraClient } from "@mastra/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useUpdateThread = () => {
  const client = useMastraClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      threadId,
      agentId,
      title,
      metadata,
    }: {
      threadId: string;
      agentId: string;
      title?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const thread = client.getMemoryThread({ threadId, agentId });
      const current = await thread.get();
      return thread.update({
        title: title ?? current.title ?? "",
        metadata: { ...(current.metadata ?? {}), ...(metadata ?? {}) },
        resourceId: current.resourceId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", "threads"] });
    },
    onError: () => {
      console.error("Failed to update chat");
    },
  });
};
