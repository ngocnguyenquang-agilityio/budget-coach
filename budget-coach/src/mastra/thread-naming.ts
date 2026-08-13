import type { CopilotRuntimeHooks } from "@copilotkit/runtime/v2";
import { mastra } from "@/mastra";
import { getResourceId } from "@/mastra/get-resource-id";

// @copilotkit/runtime's built-in `generateThreadNames` sends its
// "return JSON only" title-format instruction as a system-role message on
// the AG-UI agent clone — but @ag-ui/mastra's AG-UI-to-Mastra message
// converter only forwards assistant/user/tool roles, silently dropping
// system messages. The model never sees the format instruction, so it
// answers the fake "generate a title" transcript as a real user request
// instead (sometimes even attempting a tool call), and title generation
// fails almost every time regardless of which model is configured. This
// hook replaces the built-in feature (disabled via `generateThreadNames:
// false` on the runtime) with a direct call to the agent's own
// `.generate()`, which does apply system messages correctly.
const MAX_TITLE_WORDS = 8;

const extractLatestUserText = (messages: unknown): string | null => {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content.trim() || null;
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part: { type?: string }) => part?.type === "text")
        .map((part: { text?: string }) => part.text ?? "")
        .join("")
        .trim();
      return text || null;
    }
    return null;
  }
  return null;
};

const normalizeGeneratedTitle = (rawTitle: string): string | null => {
  let candidate = rawTitle.trim();
  if (!candidate) return null;

  candidate = candidate
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed?.title === "string") candidate = parsed.title;
  } catch {
    // Not JSON — fall through and treat the raw text as the title.
  }

  candidate = candidate
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[*_#[\]()!~>|]+/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate) return null;
  if (candidate.split(/\s+/).length > MAX_TITLE_WORDS) return null;
  return candidate;
};

const fallbackTitleFromUserText = (userText: string): string => {
  const words = userText.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}...` : words;
};

const generateTitleForThread = async ({
  agentId,
  threadId,
  userId,
  userText,
  intelligence,
}: {
  agentId: string;
  threadId: string;
  userId: string;
  userText: string;
  intelligence: NonNullable<import("@copilotkit/runtime/v2").CopilotRuntime["intelligence"]>;
}) => {
  const fallback = fallbackTitleFromUserText(userText);

  let title = fallback;
  try {
    const agent = mastra.getAgent(agentId as Parameters<typeof mastra.getAgent>[0]);
    if (agent) {
      const result = await agent.generate(
        [
          {
            role: "system",
            content: [
              "You generate short, specific conversation titles.",
              'Return JSON only in this exact shape: {"title":"..."}',
              "The title must be 2 to 5 words.",
              "Use sentence case. No quotes, emoji, or markdown. No trailing punctuation.",
              "Do not call tools.",
            ].join("\n"),
          },
          { role: "user", content: `Generate a short title for this conversation.\n\nUser: ${userText}` },
        ],
        { toolChoice: "none" },
      );
      const generated = normalizeGeneratedTitle(result.text);
      if (generated) title = generated;
    }
  } catch {
    // Keep the heuristic fallback — never leave a thread stuck "Untitled".
  }

  try {
    await intelligence.updateThread({
      threadId,
      userId,
      agentId,
      updates: { name: title },
    });
  } catch {
    // Best-effort naming; a failed rename must never break the chat request.
  }
};

export const threadNamingHooks: CopilotRuntimeHooks = {
  onBeforeHandler: async ({ request, route, runtime }) => {
    if (route.method !== "agent/run" || !runtime.intelligence) return;

    const userId = getResourceId(request);
    let threadId: string | undefined;
    let userText: string | null = null;
    try {
      const body = await request.clone().json();
      threadId = body?.threadId;
      userText = extractLatestUserText(body?.messages);
    } catch {
      return;
    }
    if (!threadId || !userText) return;

    const intelligence = runtime.intelligence;
    intelligence
      .getOrCreateThread({ threadId, userId, agentId: route.agentId })
      .then(({ thread, created }) => {
        if (!created || thread.name?.trim()) return;
        return generateTitleForThread({
          agentId: route.agentId,
          threadId,
          userId,
          userText: userText!,
          intelligence,
        });
      })
      .catch(() => {
        // Best-effort naming; never block or fail the actual chat request.
      });
  },
};
