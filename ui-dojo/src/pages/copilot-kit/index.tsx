import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import "@copilotkit/react-core/v2/styles.css";
import { CopilotKit } from "@copilotkit/react-core";
import {
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  useRenderTool,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { MASTRA_BASE_URL } from "@/constants";
import { CopilotChatPanel } from "@/components/ck/copilot-chat-panel";
import { WeatherCard } from "@/components/ck/weather-card";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { useThreadManager } from "@/hooks/use-thread-manager";

const AGENT_ID = "ck_agentic_chat";
// Memory scope the /copilotkit route persists threads under (see
// registerCopilotKit in src/mastra/index.ts). The sidebar lists threads for
// this resource so it matches what CopilotKit writes.
const RESOURCE_ID = "copilotkit-resource";

function CopilotKitDemo() {
  const { agentId, threadId } = useParams();
  const resolvedAgentId = agentId ?? AGENT_ID;

  return (
    <CopilotKit
      runtimeUrl={`${MASTRA_BASE_URL}/copilotkit`}
      agent={resolvedAgentId}
    >
      <div className="grid grid-cols-[130px_1fr] md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr] gap-x-2 size-full">
        <ThreadPanel agentId={resolvedAgentId} threadId={threadId} />
        <Chat agentId={resolvedAgentId} threadId={threadId} />
      </div>
    </CopilotKit>
  );
}

// Thread list for the CopilotKit conversation. Lists threads from the same
// LibSQL memory the runtime persists to, and refetches when a run finishes so a
// brand-new thread appears in the sidebar after its first message.
function ThreadPanel({
  agentId,
  threadId,
}: {
  agentId: string;
  threadId?: string;
}) {
  const { threads, isThreadsLoading, refreshThreads, handlers } =
    useThreadManager({
      rootPath: "copilot-kit",
      agentId,
      resourceId: RESOURCE_ID,
      threadId,
    });

  const { agent } = useAgent({
    agentId,
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !agent.isRunning) {
      refreshThreads();
    }
    wasRunning.current = agent.isRunning;
  }, [agent.isRunning, refreshThreads]);

  return (
    <ThreadSidebar
      rootPath="copilot-kit"
      threads={threads}
      isLoading={isThreadsLoading}
      threadId={threadId}
      agentId={agentId}
      {...handlers}
    />
  );
}

function Chat({ agentId, threadId }: { agentId: string; threadId?: string }) {
  const [background, setBackground] = useState<string>("var(--background)");

  useAgentContext({
    description: "Name of the user",
    value: "Bob",
  });

  useFrontendTool({
    name: "change_background",
    description:
      "Change the background of the chat. Accepts anything the CSS background attribute accepts. Regular colors, linear or radial gradients etc.",
    parameters: z.object({
      background: z
        .string()
        .describe("The background. Prefer gradients. Only use when asked."),
    }),
    handler: async ({ background: next }: { background: string }) => {
      setBackground(next);
      return {
        status: "success",
        message: `Background changed to ${next}`,
      };
    },
  });

  useRenderTool({
    name: "get_weather",
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ parameters, result, status }) => {
      if (status !== "complete") {
        return (
          <div className="text-sm text-muted-foreground">
            Loading weather...
          </div>
        );
      }

      return <WeatherCard location={parameters.location} result={result} />;
    },
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in Tokyo",
        message: "What's the weather in Tokyo?",
      },
      {
        title: "Sunset background",
        message: "Change the background to a sunset gradient.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChatPanel
      // Remount on thread switch so CopilotKit connects to the new thread and
      // hydrates its persisted messages.
      key={threadId}
      agentId={agentId}
      threadId={threadId}
      containerStyle={{ background }}
    />
  );
}

export default CopilotKitDemo;
