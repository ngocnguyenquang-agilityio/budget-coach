import { useMastraClient } from "@mastra/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useDeleteThread = () => {
  const client = useMastraClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      threadId,
      agentId,
    }: {
      threadId: string;
      agentId: string;
      resourceId?: string;
    }) => {
      const thread = client.getMemoryThread({ threadId, agentId });
      return thread.delete();
    },
    onSuccess: (_, variables) => {
      const { agentId, resourceId } = variables;
      if (agentId) {
        // Match useThreads' query key ["memory","threads",resourceId,agentId].
        // resourceId defaults to agentId for callers where they coincide
        // (e.g. the assistant-ui page).
        queryClient.invalidateQueries({
          queryKey: ["memory", "threads", resourceId ?? agentId, agentId],
        });
      }
      console.log("Chat deleted successfully");
    },
    onError: () => {
      console.error("Failed to delete chat");
    },
  });
};
