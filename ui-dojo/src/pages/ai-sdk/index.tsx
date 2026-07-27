import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Action, Actions } from "@/components/ai-elements/actions";
import { Fragment, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";
import { useAgentMessages } from "@/hooks/use-agent-messages";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { useThreadManager } from "@/hooks/use-thread-manager";
import { Response } from "@/components/ai-elements/response";
import { CopyIcon, GlobeIcon, RefreshCcwIcon } from "lucide-react";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Loader } from "@/components/ai-elements/loader";
import { DefaultChatTransport } from "ai";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { MASTRA_BASE_URL } from "@/constants";
import { getVisibleReasoningText } from "@/lib/reasoning";
import { WatchlistCard, type Film } from "@/components/watchlist-card";

const models = [
  {
    name: "gemini-3.5-flash",
    value: "google/gemini-3.5-flash",
  },
];

const suggestions = [
  "Tell me about Spirited Away",
  "Who are the main characters in Princess Mononoke?",
  "Summarize the plot of Howl's Moving Castle",
  "Add Spirited Away to my watchlist",
  "Show my watchlist",
  "Remove Spirited Away from my watchlist",
];

const RESOURCE_ID = "ui-dojo";

const AISdkDemo = () => {
  const { agentId, threadId } = useParams();
  const resolvedAgentId = agentId ?? "ghibliAgent";
  const [searchParams, setSearchParams] = useSearchParams();
  const isNewThread = searchParams.get("new") === "true";

  const { threads, isThreadsLoading, refreshThreads, handlers } =
    useThreadManager({
      rootPath: "ai-sdk",
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
    <div className="grid grid-cols-[130px_1fr] md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr] gap-x-2 size-full min-h-0">
      <ThreadSidebar
        rootPath="ai-sdk"
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
};

export default AISdkDemo;

type ChatProps = {
  agentId: string;
  threadId?: string;
  isNewThread: boolean;
  onFinish: () => void;
};

// Fetches the thread's prior transcript, then mounts the chat view once seeded.
// Splitting here matters: useChat only reads its initial `messages` on mount, so
// the view must not mount until history has resolved.
const Chat = ({ agentId, threadId, isNewThread, onFinish }: ChatProps) => {
  // Freeze the "new thread" flag at mount. `isNewThread` flips to false once
  // the first message finishes (the "new" query param gets cleared), but this
  // component is keyed by threadId and shouldn't re-enable — and briefly
  // loading-gate on — the history fetch mid-conversation, which would unmount
  // ChatView and drop whatever the user has typed since.
  const [skipHistoryFetch] = useState(isNewThread);

  // Restore prior transcript for existing threads. Skipped for a brand-new
  // thread (?new=true) whose messages don't exist server-side yet.
  const { data: history, isLoading: isHistoryLoading } = useAgentMessages({
    agentId,
    threadId: skipHistoryFetch ? undefined : threadId,
    memory: true,
  });

  if (isHistoryLoading) {
    return null;
  }

  const initialMessages = history?.messages
    ? (toAISdkV5Messages(history.messages) as UIMessage[])
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
  initialMessages: UIMessage[];
  threadId?: string;
  onFinish: () => void;
};

const ChatView = ({ initialMessages, threadId, onFinish }: ChatViewProps) => {
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(models[0].value);
  const [webSearch, setWebSearch] = useState(false);

  const { messages, sendMessage, status, regenerate } = useChat({
    messages: initialMessages,
    onFinish,
    transport: new DefaultChatTransport({
      // Defined through chatRoute() in src/mastra/index.ts
      api: `${MASTRA_BASE_URL}/chat/ghibliAgent`,
      body: { memory: { resource: RESOURCE_ID, thread: threadId } },
    }),
  });

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    sendMessage(
      {
        text: message.text || "Sent with attachments",
        files: message.files,
      },
      {
        body: {
          model: model,
          webSearch: webSearch,
        },
      },
    );
    setInput("");
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage({ text: suggestion });
  };

  const handleRemoveFilm = (title: string) => {
    sendMessage({ text: `Remove ${title} from my watchlist` });
  };

  return (
    <div className="max-w-4xl mx-auto p-0 md:p-6 relative size-full min-h-0">
      <div className="flex flex-col h-full min-h-0">
        <Conversation className="h-full">
          <ConversationContent>
            {messages.map((message, messageIndex) => {
              const isLastAssistantMessage =
                message.role === "assistant" &&
                messageIndex === messages.length - 1;
              const reasoningText = getVisibleReasoningText(message.parts);
              const isReasoningStreaming =
                isLastAssistantMessage &&
                status === "streaming" &&
                message.parts.at(-1)?.type === "reasoning";

              return (
                <div key={message.id}>
                  {message.role === "assistant" &&
                    message.parts.filter((part) => part.type === "source-url")
                      .length > 0 && (
                      <Sources>
                        <SourcesTrigger
                          count={
                            message.parts.filter(
                              (part) => part.type === "source-url",
                            ).length
                          }
                        />
                        {message.parts
                          .filter((part) => part.type === "source-url")
                          .map((part, i) => (
                            <SourcesContent key={`${message.id}-${i}`}>
                              <Source
                                key={`${message.id}-${i}`}
                                href={part.url}
                                title={part.url}
                              />
                            </SourcesContent>
                          ))}
                      </Sources>
                    )}
                  {reasoningText && (
                    <Reasoning
                      className="w-full"
                      isStreaming={isReasoningStreaming}
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{reasoningText}</ReasoningContent>
                    </Reasoning>
                  )}
                  {message.parts.map((part, i) => {
                    switch (part.type) {
                      case "text":
                        return (
                          <Fragment key={`${message.id}-${i}`}>
                            <Message from={message.role}>
                              <MessageContent>
                                <Response>{part.text}</Response>
                              </MessageContent>
                            </Message>
                            {isLastAssistantMessage && (
                              <Actions className="mt-2">
                                <Action
                                  onClick={() => regenerate()}
                                  label="Retry"
                                >
                                  <RefreshCcwIcon className="size-3" />
                                </Action>
                                <Action
                                  onClick={() =>
                                    navigator.clipboard.writeText(part.text)
                                  }
                                  label="Copy"
                                >
                                  <CopyIcon className="size-3" />
                                </Action>
                              </Actions>
                            )}
                          </Fragment>
                        );
                      case "reasoning":
                        return null;
                      case "tool-show_watchlist":
                        switch (part.state) {
                          case "input-available":
                            return <Loader key={`${message.id}-${i}`} />;
                          case "output-available":
                            return (
                              <WatchlistCard
                                key={`${message.id}-${i}`}
                                films={(part.output as { films: Film[] }).films}
                                onRemove={handleRemoveFilm}
                              />
                            );
                          case "output-error":
                            return (
                              <div key={`${message.id}-${i}`}>
                                Error: {part.errorText}
                              </div>
                            );
                          default:
                            return null;
                        }
                      default:
                        return null;
                    }
                  })}
                </div>
              );
            })}
            {status === "submitted" && <Loader />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <Suggestions>
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              onClick={handleSuggestionClick}
              suggestion={suggestion}
            />
          ))}
        </Suggestions>

        <PromptInput
          onSubmit={handleSubmit}
          className="mt-4"
          globalDrop
          multiple
        >
          <PromptInputBody>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <PromptInputButton
                variant={webSearch ? "default" : "ghost"}
                onClick={() => setWebSearch(!webSearch)}
              >
                <GlobeIcon size={16} />
                <span>Search</span>
              </PromptInputButton>
              <PromptInputModelSelect
                onValueChange={(value) => {
                  setModel(value);
                }}
                value={model}
              >
                <PromptInputModelSelectTrigger>
                  <PromptInputModelSelectValue />
                </PromptInputModelSelectTrigger>
                <PromptInputModelSelectContent>
                  {models.map((model) => (
                    <PromptInputModelSelectItem
                      key={model.value}
                      value={model.value}
                    >
                      {model.name}
                    </PromptInputModelSelectItem>
                  ))}
                </PromptInputModelSelectContent>
              </PromptInputModelSelect>
            </PromptInputTools>
            <PromptInputSubmit disabled={!input && !status} status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
};
