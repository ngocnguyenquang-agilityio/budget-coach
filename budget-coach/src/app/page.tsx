"use client";

import dynamic from "next/dynamic";
import { CopilotChatConfigurationProvider } from "@copilotkit/react-core/v2";

import { Dashboard } from "@/components/dashboard";
import { ThreadsDrawer, threadsLayoutStyle } from "@/components/threads-drawer";

import styles from "./page.module.css";

// Client-only: CopilotSidebar reaches for browser APIs the server can't
// prerender, and eager-loading it can race the lazily-compiled API route in
// dev.
const CopilotSidebar = dynamic(
  () => import("@copilotkit/react-core/v2").then((mod) => mod.CopilotSidebar),
  { ssr: false },
);

const BudgetCoachPage = () => {
  return (
    <CopilotChatConfigurationProvider agentId="coach">
      <div
        className={`${styles.layout} threadsLayout`}
        style={threadsLayoutStyle}
      >
        <ThreadsDrawer agentId="coach" />
        <div className={styles.mainPanel}>
          <main className="h-full flex">
            <Dashboard />
            <CopilotSidebar
              defaultOpen={true}
              labels={{
                modalHeaderTitle: "Budget Coach",
                welcomeMessageText:
                  "👋 Hi, I'm your Budget Coach. Ask me about your spending, set a savings goal, or add a transaction.",
              }}
            />
          </main>
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  );
};

export default BudgetCoachPage;
