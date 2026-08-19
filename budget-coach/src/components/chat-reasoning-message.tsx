"use client";

import { CopilotChatReasoningMessage } from "@copilotkit/react-core/v2";
import type { ComponentProps } from "react";

// Forces the header into its non-expandable state and drops onClick, so the
// "Thought for Xs" label renders with no chevron and nothing to expand.
const StaticReasoningHeader = (
  props: ComponentProps<typeof CopilotChatReasoningMessage.Header>,
) => (
  <CopilotChatReasoningMessage.Header {...props} hasContent={false} onClick={undefined} />
);

export const reasoningMessageSlot = {
  header: StaticReasoningHeader,
  contentView: () => null,
};
