import { useParams, useSearchParams } from "react-router";
import {
  toAssistantUIMessage,
  useChat,
  type MastraUIMessage,
} from "@mastra/react";
import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";
import { useRef } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { useAgent } from "@/hooks/use-agent";
import { useAgentMessages } from "@/hooks/use-agent-messages";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { useThreadManager } from "@/hooks/use-thread-manager";

const suggestions = [
  {
    title: "What's the latest movie?",
    action: "What's the latest movie?",
  },
  {
    title: "What's the first Ghibli movie?",
    action: "What's the first Ghibli movie?",
  },
  {
    title: "How many Ghibli movies are there?",
    action: "How many Ghibli movies are there?",
  },
  {
    title: "What's the longest Ghibli movie?",
    action: "What's the longest Ghibli movie?",
  },
];

const AssistantUIDemo = () => {
  const { agentId, threadId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNewThread = searchParams.get("new") === "true";

  const { data: agent, isLoading: isAgentLoading } = useAgent(agentId!);
  const { threads, isThreadsLoading, isMemoryEnabled, refreshThreads, handlers } =
    useThreadManager({
      rootPath: "assistant-ui",
      agentId: agentId!,
      resourceId: agentId!,
      threadId,
    });

  if (isAgentLoading) {
    return null;
  }

  const handleRefreshThreadList = () => {
    searchParams.delete("new");
    setSearchParams(searchParams);
    refreshThreads();
  };

  return (
    <div className="grid grid-cols-[130px_1fr] md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr] gap-x-2 size-full">
      <ThreadSidebar
        rootPath="assistant-ui"
        threads={threads}
        isLoading={isThreadsLoading}
        threadId={threadId}
        agentId={agentId!}
        {...handlers}
      />
      <Chat
        agentId={agentId!}
        agentName={agent?.name}
        threadId={threadId}
        memory={isMemoryEnabled}
        refreshThreadList={handleRefreshThreadList}
        isNewThread={isNewThread}
      />
    </div>
  );
};

export default AssistantUIDemo;

interface ChatProps {
  agentId: string;
  agentName?: string;
  threadId?: string;
  initialMessages?: MastraUIMessage[];
  memory?: boolean;
  refreshThreadList?: () => void;
}

const Chat = ({
  agentId,
  threadId,
  memory,
  agentName,
  refreshThreadList,
  isNewThread,
}: Omit<ChatProps, "initialMessages"> & { isNewThread?: boolean }) => {
  const { data, isLoading: isMessagesLoading } = useAgentMessages({
    agentId: agentId,
    threadId: isNewThread ? undefined : threadId!,
    memory: memory ?? false,
  });

  if (isMessagesLoading) {
    return null;
  }

  return (
    <CustomRuntimeProvider
      key={threadId}
      initialMessages={
        data?.messages
          ? (toAISdkV5Messages(data.messages) as MastraUIMessage[])
          : []
      }
      agentId={agentId}
      threadId={threadId}
      refreshThreadList={refreshThreadList}
    >
      <Thread
        suggestions={suggestions}
        agentName={agentName}
        welcome="Ask me about Ghibli movies, characters, and trivia."
      />
    </CustomRuntimeProvider>
  );
};

const CustomRuntimeProvider = ({
  children,
  agentId,
  initialMessages,
  threadId,
  refreshThreadList,
}: { children: React.ReactNode } & Omit<ChatProps, "memory" | "agentName">) => {
  const {
    messages,
    sendMessage,
    cancelRun,
    isRunning: isRunningStream,
    setMessages,
  } = useChat({
    agentId,
    initialMessages: initialMessages || [],
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const onNew = async (message: AppendMessage) => {
    if (message.content[0]?.type !== "text")
      throw new Error("Only text messages are supported");

    const input = message.content[0].text;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await sendMessage({
        message: input,
        mode: "stream",
        threadId,
        onChunk: async (chunk) => {
          if (chunk.type === "finish") {
            await refreshThreadList?.();
          }
        },
        signal: controller.signal,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Error occurred in CustomRuntimeProvider", error);

      if (error.name === "AbortError") {
        return;
      }

      setMessages((currentConversation) => [
        ...currentConversation,
        {
          role: "assistant",
          parts: [{ type: "text", text: `${error}` }],
        } as MastraUIMessage,
      ]);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const onCancel = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      cancelRun?.();
    }
  };

  const messagesForRuntime = messages.map(toAssistantUIMessage);

  const runtime = useExternalStoreRuntime({
    isRunning: isRunningStream,
    messages: messagesForRuntime,
    convertMessage: (x) => x,
    onNew,
    onCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};
