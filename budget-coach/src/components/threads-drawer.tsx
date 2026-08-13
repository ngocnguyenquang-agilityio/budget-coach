"use client";

import type { CSSProperties } from "react";
import { CopilotThreadsDrawer } from "@copilotkit/react-core/v2";

// CopilotThreadsDrawer's thread list is a CopilotKit Intelligence (licensed)
// feature: without COPILOTKIT_LICENSE_TOKEN the runtime never reports a
// "valid"/"expiring" license, so the drawer's `useThreads` hook never leaves
// its pending state and the drawer is stuck on "Loading threads…" forever,
// even though the local REST thread endpoints it also depends on respond
// fine. next.config.ts derives NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED from
// the same token for exactly this — only mount the drawer when it can
// actually resolve.
const THREADS_ENABLED =
  process.env.NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED === "true";

// When the drawer isn't mounted, collapse the layout's reserved first column
// (see src/app/page.module.css .layout) instead of leaving dead space.
export const threadsLayoutStyle: CSSProperties | undefined = THREADS_ENABLED
  ? undefined
  : ({ "--cpk-drawer-reserved-width": "0px" } as CSSProperties & Record<string, string>);

export const ThreadsDrawer = ({ agentId }: { agentId: string }) => {
  if (!THREADS_ENABLED) return null;
  return <CopilotThreadsDrawer agentId={agentId} />;
};
