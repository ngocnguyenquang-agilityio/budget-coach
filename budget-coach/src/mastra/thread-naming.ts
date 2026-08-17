import { mastra } from "@/mastra";
import { getCoachMemory, isOwnedBy } from "@/mastra/threads";

// Generates the short conversation titles the drawer shows.
//
// This used to run as a CopilotRuntime hook that wrote to the Intelligence
// platform. Two reasons it no longer does: Intelligence is gone (its runner
// cannot survive serverless), and the hook fired title generation
// fire-and-forget *inside* the agent-run request — work continuing after the
// response, which is precisely what Vercel freezes. It is now an explicit call
// the client awaits, and the title lands in mastra_threads.title.
//
// The generation itself is unchanged and still needed: @ag-ui/mastra's message
// converter drops system-role messages, so a title asked for through the AG-UI
// stream never sees its format instruction. Calling agent.generate() directly
// applies system messages correctly.

const MAX_TITLE_WORDS = 8;

type MastraMessagePart = { type?: string; text?: string };
type MastraStoredMessage = {
  role?: string;
  content?: { parts?: MastraMessagePart[] } | null;
};

const extractFirstUserText = (messages: MastraStoredMessage[]): string | null => {
  for (const message of messages) {
    if (message.role !== "user") continue;

    const text = (message.content?.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (text) return text;
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

/**
 * Generates and persists a title for a thread the caller owns.
 *
 * Returns the stored title, or null when the thread is missing, not the
 * caller's, already titled, or has no user message to summarize.
 */
export const generateThreadTitle = async ({
  threadId,
  resourceId,
}: {
  threadId: string;
  resourceId: string;
}): Promise<string | null> => {
  const memory = await getCoachMemory();
  const thread = await memory.getThreadById({ threadId });
  if (!isOwnedBy(thread, resourceId)) return null;
  if (thread?.title?.trim()) return thread.title;

  // The text is read from stored memory rather than taken from the request, so a
  // caller cannot influence what gets summarized for someone else's thread.
  const { messages } = await memory.recall({ threadId, resourceId });
  const userText = extractFirstUserText(messages as unknown as MastraStoredMessage[]);
  if (!userText) return null;

  let title = fallbackTitleFromUserText(userText);

  try {
    const result = await mastra.getAgent("coach").generate(
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
        {
          role: "user",
          content: `Generate a short title for this conversation.\n\nUser: ${userText}`,
        },
      ],
      { toolChoice: "none" },
    );

    const generated = normalizeGeneratedTitle(result.text);
    if (generated) title = generated;
  } catch {
    // Keep the heuristic fallback — never leave a thread stuck untitled.
  }

  await memory.updateThread({
    id: threadId,
    title,
    metadata: thread?.metadata ?? {},
  });

  return title;
};
