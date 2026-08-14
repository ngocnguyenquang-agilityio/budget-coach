"use client";

import type { CSSProperties } from "react";
import { CopilotThreadsDrawer } from "@copilotkit/react-core/v2";

const THREADS_ENABLED =
  process.env.NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED === "true";

export const threadsLayoutStyle: CSSProperties | undefined = THREADS_ENABLED
  ? undefined
  : ({ "--cpk-drawer-reserved-width": "0px" } as CSSProperties &
      Record<string, string>);

export const ThreadsDrawer = ({ agentId }: { agentId: string }) => {
  if (!THREADS_ENABLED) return null;
  return <CopilotThreadsDrawer agentId={agentId} />;
};
