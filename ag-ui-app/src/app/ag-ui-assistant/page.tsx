"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import {
  useAgent,
  useFrontendTool,
  useHumanInTheLoop,
  CopilotChatConfigurationProvider,
  CopilotSidebar,
} from "@copilotkit/react-core/v2";

import { WeatherCard } from "@/components/weather";
import { OpenUrlCard } from "@/components/open-url";
import { SessionDashboard } from "@/components/session-dashboard";
import { evaluateExpression } from "@/lib/calculator";
import {
  initialAgUiAssistantState,
  type AgUiAssistantState,
} from "@/lib/agUiAssistantState";

/**
 * Ported from my-ag-ui-client's CLI agent (weather + calculate + openUrl)
 * onto the CopilotKit v2 hooks this app already uses for the /  demo:
 * "calculate" is a plain frontend tool (deterministic, no UI needed),
 * "openUrl" is human-in-the-loop (browser can't shell out to the OS
 * default browser, so approval opens a new tab instead), and weather
 * reuses the same generative-UI card as the / page.
 */
export default function AgUiAssistantPage() {
  return (
    <CopilotChatConfigurationProvider agentId="agUiAssistant">
      <AssistantContent />
    </CopilotChatConfigurationProvider>
  );
}

function mergeState(agentState: unknown): AgUiAssistantState {
  return {
    ...initialAgUiAssistantState,
    ...(agentState as Partial<AgUiAssistantState> | undefined),
  };
}

function AssistantContent() {
  const [themeColor] = useState("#6366f1");
  const { agent } = useAgent({ agentId: "agUiAssistant" });
  const state = mergeState(agent.state);

  // Seed working memory once so the dashboard has a defined shape from the start.
  useEffect(() => {
    if (agent.state === undefined) {
      agent.setState(initialAgUiAssistantState);
    }
  }, [agent]);

  useFrontendTool({
    name: "weatherTool",
    description: "Get the weather for a given location.",
    available: false,
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ args }) => (
      <WeatherCard location={args?.location} themeColor={themeColor} />
    ),
  });

  useFrontendTool({
    name: "calculate",
    description:
      "Evaluate an arithmetic expression and return the numeric result. " +
      "Use for any math the user asks for. Supports + - * / % ^, parentheses, " +
      'and decimals. Pass the whole expression as a single string, e.g. "30 - 5".',
    parameters: z.object({
      expression: z
        .string()
        .describe('The arithmetic expression to evaluate, e.g. "(30 - 5) * 2"'),
    }),
    handler: async ({ expression }) => {
      const result = evaluateExpression(expression);
      const current = mergeState(agent.state);
      agent.setState({
        ...current,
        calculations: [
          ...current.calculations,
          { expression, result: result.message, at: new Date().toISOString() },
        ],
        lastUpdated: new Date().toISOString(),
      } satisfies AgUiAssistantState);
      return result.message;
    },
  });

  useHumanInTheLoop({
    name: "openUrl",
    description:
      "Open a URL in a new browser tab. Use for http/https links the user wants to visit.",
    parameters: z.object({
      url: z.string().describe("The absolute http(s) URL to open"),
    }),
    render: ({ args, respond, status }) => (
      <OpenUrlCard
        url={args.url}
        status={status}
        respond={respond}
        onOpened={(url) => {
          const current = mergeState(agent.state);
          agent.setState({
            ...current,
            openedUrls: [...current.openedUrls, url],
            lastUpdated: new Date().toISOString(),
          } satisfies AgUiAssistantState);
        }}
      />
    ),
  });

  return (
    <div
      className="h-screen flex items-center justify-center flex-col gap-4"
      style={{ backgroundColor: themeColor }}
    >
      <SessionDashboard state={state} />
      <CopilotSidebar
        defaultOpen
        labels={{
          modalHeaderTitle: "AG-UI Assistant",
          welcomeMessageText:
            "👋 Ask me about the weather, do some math, or have me open a link.",
        }}
      />
    </div>
  );
}
