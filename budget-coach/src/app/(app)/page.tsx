"use client";

import dynamic from "next/dynamic";
import { CopilotChatConfigurationProvider } from "@copilotkit/react-core/v2";

import { Dashboard } from "@/components/dashboard";
import { reasoningMessageSlot } from "@/components/chat-reasoning-message";
import { ThreadsDrawer } from "@/components/threads-drawer";

import styles from "./page.module.css";

const CopilotSidebar = dynamic(
  () => import("@copilotkit/react-core/v2").then((mod) => mod.CopilotSidebar),
  { ssr: false },
);

const BudgetCoachPage = () => {
  return (
    <CopilotChatConfigurationProvider agentId="coach">
      <div className={`${styles.layout} threadsLayout`}>
        <ThreadsDrawer />
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
              messageView={{ reasoningMessage: reasoningMessageSlot }}
            />
          </main>
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  );
};

export default BudgetCoachPage;
