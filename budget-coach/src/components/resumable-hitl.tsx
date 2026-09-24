"use client";

import type { ReactNode } from "react";
import { UseAgentUpdate, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";

type HitlStatus = "inProgress" | "executing" | "complete";

export interface ResumableHitlProps {
  agentId: string;
  toolCallId: string;
  status: HitlStatus;
  respond?: (response: unknown) => void;
  children: (props: { status: HitlStatus; respond?: (response: unknown) => void }) => ReactNode;
}

// A useHumanInTheLoop call is only answerable while the page that received it
// is alive: `respond` resolves an in-memory promise that CopilotKit's tool
// handler is awaiting. Reload the app (or re-open the thread) before answering
// and the restored tool call has no result and no running handler, so
// CopilotKit renders it as "inProgress" with no `respond` forever — the card
// shows but its buttons never appear.
//
// Once the agent is idle, such a call is orphaned rather than still streaming.
// For that case this supplies a `respond` that does what CopilotKit's own
// handler path does: insert the `tool` result right after the calling
// assistant message and run a follow-up turn.
export const ResumableHitl = ({ agentId, toolCallId, status, respond, children }: ResumableHitlProps) => {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({
    agentId,
    updates: [UseAgentUpdate.OnRunStatusChanged, UseAgentUpdate.OnMessagesChanged],
  });

  const hasResult = agent.messages.some(
    (message) => message.role === "tool" && message.toolCallId === toolCallId,
  );
  const orphaned = status === "inProgress" && !agent.isRunning && !hasResult;
  if (!orphaned) return <>{children({ status, respond })}</>;

  const resumeRespond = (response: unknown) => {
    const messages = agent.messages;
    const callIndex = messages.findIndex(
      (message) =>
        message.role === "assistant" && message.toolCalls?.some((call) => call.id === toolCallId),
    );
    if (callIndex === -1) return;
    if (messages.some((message) => message.role === "tool" && message.toolCallId === toolCallId)) return;

    let insertAt = callIndex + 1;
    while (messages[insertAt]?.role === "tool") insertAt++;
    agent.setMessages([
      ...messages.slice(0, insertAt),
      {
        id: crypto.randomUUID(),
        role: "tool",
        toolCallId,
        content: typeof response === "string" ? response : JSON.stringify(response),
      },
      ...messages.slice(insertAt),
    ]);
    void copilotkit.runAgent({ agent });
  };

  return <>{children({ status: "executing", respond: resumeRespond })}</>;
};
