import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { MastraClient } from "@mastra/client-js";
import type { UIMessage } from "ai";
import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Loader } from "@/components/ai-elements/loader";
import { Response } from "@/components/ai-elements/response";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { MASTRA_BASE_URL } from "@/constants";
import { useAgentMessages } from "@/hooks/use-agent-messages";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { useThreadManager } from "@/hooks/use-thread-manager";

const client = new MastraClient({
  baseUrl: MASTRA_BASE_URL,
});

const AGENT_ID = "ghibliAgent";
// Distinct from the AI SDK demo's "ui-dojo" resource so the two frameworks'
// thread sidebars don't bleed into each other.
const RESOURCE_ID = "mastra-client-sdk";
const agent = client.getAgent(AGENT_ID);

const suggestions = [
  "Tell me about Spirited Away",
  "Who is Howl in Howl's Moving Castle?",
  "Recommend a Studio Ghibli movie for a first watch",
];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

// Flatten restored Mastra messages into the page's simple {id, role, text} shape.
function toChatMessages(uiMessages: UIMessage[]): ChatMessage[] {
  return uiMessages
    .map((message) => ({
      id: message.id ?? crypto.randomUUID(),
      role: message.role === "assistant" ? "assistant" : "user",
      text: message.parts
        .filter((part) => part.type === "text")
        .map((part) => ("text" in part ? part.text : ""))
        .join(""),
    }))
    .filter((message): message is ChatMessage => message.text.length > 0);
}

export default function AgentStreamPage() {
  const { agentId, threadId } = useParams();
  const resolvedAgentId = agentId ?? AGENT_ID;
  const [searchParams, setSearchParams] = useSearchParams();
  const isNewThread = searchParams.get("new") === "true";

  const { threads, isThreadsLoading, refreshThreads, handlers } =
    useThreadManager({
      rootPath: "mastra-client-sdk",
      agentId: resolvedAgentId,
      resourceId: RESOURCE_ID,
      threadId,
    });

  const handleRefreshThreadList = () => {
    if (searchParams.has("new")) {
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
    refreshThreads();
  };

  return (
    <div className="grid grid-cols-[130px_1fr] md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr] gap-x-2 size-full">
      <ThreadSidebar
        rootPath="mastra-client-sdk"
        threads={threads}
        isLoading={isThreadsLoading}
        threadId={threadId}
        agentId={resolvedAgentId}
        {...handlers}
      />
      <Chat
        key={threadId}
        agentId={resolvedAgentId}
        threadId={threadId}
        isNewThread={isNewThread}
        onFinish={handleRefreshThreadList}
      />
    </div>
  );
}

type ChatProps = {
  agentId: string;
  threadId?: string;
  isNewThread: boolean;
  onFinish: () => void;
};

// Fetches the thread's prior transcript, then mounts the stateful view once
// seeded (the view seeds its message state from a prop on mount).
const Chat = ({ agentId, threadId, isNewThread, onFinish }: ChatProps) => {
  // Freeze the "new thread" flag at mount — see ai-sdk/index.tsx's Chat for
  // why re-reading the live prop here would unmount ChatView mid-conversation.
  const [skipHistoryFetch] = useState(isNewThread);

  const { data: history, isLoading: isHistoryLoading } = useAgentMessages({
    agentId,
    threadId: skipHistoryFetch ? undefined : threadId,
    memory: true,
  });

  if (isHistoryLoading) {
    return null;
  }

  const initialMessages = history?.messages
    ? toChatMessages(toAISdkV5Messages(history.messages) as UIMessage[])
    : [];

  return (
    <ChatView
      initialMessages={initialMessages}
      threadId={threadId}
      onFinish={onFinish}
    />
  );
};

type ChatViewProps = {
  initialMessages: ChatMessage[];
  threadId?: string;
  onFinish: () => void;
};

function ChatView({ initialMessages, threadId, onFinish }: ChatViewProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(userText: string) {
    if (!userText.trim() || isStreaming || !threadId) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: userText,
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
    };

    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      assistantMessage,
    ]);
    setInput("");
    setError(null);
    setIsStreaming(true);

    try {
      const stream = await agent.stream(userText, {
        memory: {
          resource: RESOURCE_ID,
          thread: threadId,
        },
      });

      await stream.processDataStream({
        onChunk: async (chunk) => {
          switch (chunk.type) {
            case "text-delta":
              if (typeof chunk.payload?.text !== "string") {
                return;
              }

              setMessages((currentMessages) => {
                const currentAssistant =
                  currentMessages.find(
                    (message) => message.id === assistantMessage.id,
                  )?.text ?? "";

                return currentMessages.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, text: currentAssistant + chunk.payload.text }
                    : message,
                );
              });
              break;
            default:
              break;
          }
        },
      });

      // Surface the freshly-persisted thread in the sidebar.
      onFinish();
    } catch (streamError) {
      setError(
        streamError instanceof Error
          ? streamError.message
          : "Streaming request failed.",
      );

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                text: "The request failed. Check the browser console and your Mastra server logs.",
              }
            : message,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }

  function handleSubmit(message: PromptInputMessage) {
    if (!message.text) {
      return;
    }

    void sendMessage(message.text);
  }

  return (
    <div className="relative mx-auto size-full max-w-4xl p-0 md:p-6">
      <div className="flex h-full flex-col">
        <Conversation className="h-full">
          <ConversationContent>
            {messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  <Response>{message.text || "..."}</Response>
                </MessageContent>
              </Message>
            ))}
            {isStreaming ? <Loader /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <Suggestions>
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              onClick={() => void sendMessage(suggestion)}
              suggestion={suggestion}
            />
          ))}
        </Suggestions>

        <PromptInput className="mt-4" onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(event) => setInput(event.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit disabled={!input && !isStreaming} status={isStreaming ? "streaming" : "ready"} />
          </PromptInputFooter>
        </PromptInput>

        {error ? <p className="mt-3 text-destructive text-sm">{error}</p> : null}
      </div>
    </div>
  );
}
