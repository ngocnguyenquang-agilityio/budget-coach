import "@copilotkit/react-core/v2/styles.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { CopilotKit } from "@copilotkit/react-core";
import {
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  useRenderTool,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { readFileAsBase64, type AttachmentUploadResult } from "@copilotkit/shared";
import type { StorageThreadType } from "@mastra/core/memory";
import { SearchIcon } from "lucide-react";
import { z } from "zod";
import { MASTRA_BASE_URL } from "@/constants";
import { CopilotChatPanel } from "@/components/ck/copilot-chat-panel";
import { AttachedFileCard } from "@/components/ck/attached-file-card";
import { DemoSearchPopup } from "@/components/ck/demo-search-popup";
import { DemoSearchResultsCard } from "@/components/ck/demo-search-results-card";
import { ThemeToggle } from "@/components/ck/theme-toggle";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { useSidebar } from "@/components/ui/sidebar";
import { extractFileText } from "@/lib/extract-file-text";
import { searchDemos } from "@/lib/demo-catalog";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { useThreadManager } from "@/hooks/use-thread-manager";
import { isPinned } from "@/lib/thread-metadata";

/** Text the model is allowed to see per attached file, to keep prompts bounded. */
const MAX_EXTRACTED_CHARACTERS = 20_000;

const AGENT_ID = "ck_frontend_tools";

const DEFAULT_BACKGROUND = "var(--background)";

/** Resolves "system" to whatever the OS currently renders, so toggle has a real light/dark to flip. */
function isDarkResolved(theme: "light" | "dark" | "system"): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const ACTIVITY_SUGGESTIONS = [
  "Take a 10-minute walk and notice five things you have never seen before.",
  "Brew a fancy cup of tea and read one chapter of a book you love.",
  "Sketch the view outside your window, no erasing allowed.",
  "Call a friend you have not spoken to in a while, just to say hi.",
  "Try a 5-minute desk stretch routine to reset your posture.",
  "Write down three tiny wins from today, however small.",
] as const;

// Memory scope the /copilotkit route persists threads under (see
// registerCopilotKit in src/mastra/index.ts). The sidebar lists threads for
// this resource so it matches what CopilotKit writes.
const RESOURCE_ID = "copilotkit-resource";

const FrontendToolsCopilotKitDemo = () => {
  const { agentId, threadId } = useParams();
  const resolvedAgentId = agentId ?? AGENT_ID;

  return (
    <CopilotKit
      runtimeUrl={`${MASTRA_BASE_URL}/copilotkit`}
      agent={resolvedAgentId}
    >
      <DemoBody agentId={resolvedAgentId} threadId={threadId} />
    </CopilotKit>
  );
};

// Fetches the thread list ONCE and hands it to both the sidebar and the chat
// panel. ThreadPanel and Chat previously each called useThreadManager
// independently; with staleTime/gcTime both 0 on that query, two separate
// observers could desync (the sidebar showing pinned threads while Chat's own
// copy of `threads` was still empty), so the agent's "pinned conversations"
// context reported empty even though the sidebar clearly showed pins. A
// single shared call guarantees both sides see the exact same data.
function DemoBody({
  agentId,
  threadId,
}: {
  agentId: string;
  threadId?: string;
}) {
  const { threads, isThreadsLoading, refreshThreads, handlers } =
    useThreadManager({
      rootPath: "copilot-kit/frontend-tools",
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
    <div className="grid grid-cols-[130px_1fr] md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr] gap-x-2 size-full">
      <ThreadSidebar
        rootPath="copilot-kit/frontend-tools"
        threads={threads}
        isLoading={isThreadsLoading}
        threadId={threadId}
        agentId={agentId}
        {...handlers}
      />
      <Chat agentId={agentId} threadId={threadId} threads={threads} />
    </div>
  );
}

const Chat = ({
  agentId,
  threadId,
  threads,
}: {
  agentId: string;
  threadId?: string;
  threads: StorageThreadType[];
}) => {
  const [background, setBackground] = useState<string>(DEFAULT_BACKGROUND);
  const { theme, setTheme } = useTheme();
  const { state, setOpen, toggleSidebar } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Bridges "file the user picked" (only available inside the attachments
  // onUpload callback) to "the show_attached_file tool handler" (which only
  // receives the agent's JSON args), keyed by filename.
  const filesRef = useRef<Map<string, File>>(new Map());

  // Cmd/Ctrl+K opens the demo search popup, mirroring the sidebar's own
  // Cmd/Ctrl+B shortcut (src/components/ui/sidebar.tsx). Scoped to this page's
  // mount lifetime via the effect cleanup.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Expose current UI state for display/debugging. NOTE: "toggle" requests are
  // resolved inside the set_theme/set_sidebar tool handlers (browser-side),
  // NOT by having the model read these values back and compute the opposite —
  // that round-trip is unreliable and previously caused the theme to flip
  // repeatedly in a single turn.
  useAgentContext({ description: "Current UI theme", value: theme });
  useAgentContext({ description: "Current sidebar state", value: state });

  // Shared state, same pattern as theme/sidebar above: the pinned-thread list
  // is pushed into context on every change rather than fetched via a tool
  // call, so the agent always has it on hand instead of needing to decide to
  // "look it up".
  const pinnedConversations = useMemo(
    () =>
      threads
        .filter(isPinned)
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .map((thread) => ({
          id: thread.id,
          title: thread.title?.trim() || "Untitled Thread",
          updatedAt: new Date(thread.updatedAt).toISOString(),
        })),
    [threads],
  );
  useAgentContext({
    description: "Pinned conversations (title, most recently updated first)",
    value: pinnedConversations,
  });

  // SYNC frontend tool: mutates UI state synchronously and returns immediately.
  useFrontendTool({
    name: "change_background",
    description:
      "Change the background of the page. Accepts any valid CSS background value (solid colors, linear or radial gradients, etc.).",
    parameters: z.object({
      background: z
        .string()
        .describe(
          "A CSS background value. Prefer tasteful gradients, e.g. 'linear-gradient(135deg, #dbeafe, #bfdbfe)'.",
        ),
    }),
    handler: async ({ background: next }) => {
      setBackground(next);
      return {
        status: "success",
        message: `Background changed to ${next}`,
      };
    },
  });

  // SYNC frontend tool: switches the app's color theme via the shared
  // ThemeProvider. "toggle" is resolved HERE (in the browser, where the real
  // current theme is known) rather than asked of the model — the model has no
  // reliable way to read the live theme value back out of chat context, so
  // leaving "pick the opposite" up to it caused repeated/oscillating tool calls.
  useFrontendTool({
    name: "set_theme",
    description:
      "Set the application's color theme. Use 'light', 'dark', or 'system' (follows the OS). Use 'toggle' to flip between light and dark — do not try to compute the opposite yourself.",
    parameters: z.object({
      theme: z
        .enum(["light", "dark", "system", "toggle"])
        .describe("The theme to apply, or 'toggle' to flip light/dark."),
    }),
    handler: async ({ theme: next }) => {
      const resolved =
        next === "toggle"
          ? isDarkResolved(theme)
            ? "light"
            : "dark"
          : next;
      setTheme(resolved);
      return {
        status: "success",
        message: `Theme set to ${resolved}`,
      };
    },
  });

  // SYNC frontend tool: collapses or expands the shared shadcn sidebar via
  // useSidebar() from the layout's SidebarProvider. Current state is exposed via
  // useAgentContext above so the agent can resolve "toggle" to the opposite.
  useFrontendTool({
    name: "set_sidebar",
    description:
      "Collapse or expand the navigation sidebar. Use 'toggle' to flip the current state (read it from the Current sidebar state context).",
    parameters: z.object({
      action: z
        .enum(["expand", "collapse", "toggle"])
        .describe("What to do with the sidebar."),
    }),
    handler: async ({ action }) => {
      if (action === "toggle") toggleSidebar();
      else setOpen(action === "expand");
      return {
        status: "success",
        message: `Sidebar ${action}`,
      };
    },
  });

  // SYNC frontend tool: opens/closes the demo-search command palette and
  // optionally prefills its query. Deliberately NO "toggle" action — unlike
  // set_theme/set_sidebar there is nothing worth reading back into agent
  // context (see the comment above), and resolving a toggle would mean either
  // a stale-closure read of searchOpen inside the handler or a functional
  // setState that can't report the resulting state back to the model.
  useFrontendTool({
    name: "open_search_popup",
    description:
      "Open the demo search popup — a command palette listing every demo page in this app. Pass 'query' to prefill the search box with what the user is looking for. Pass action 'close' only when the user asks to dismiss it.",
    parameters: z.object({
      query: z
        .string()
        .optional()
        .describe("Text to prefill the search box with, e.g. 'workflow'."),
      action: z
        .enum(["open", "close"])
        .optional()
        .describe("Defaults to 'open'."),
    }),
    handler: async ({ query, action }) => {
      const shouldOpen = (action ?? "open") === "open";
      if (query !== undefined) setSearchQuery(query);
      setSearchOpen(shouldOpen);
      return {
        status: "success",
        message: shouldOpen
          ? `Search popup opened${query ? ` with "${query}"` : ""}`
          : "Search popup closed",
      };
    },
  });

  // SYNC frontend tool: searches the app's own demo catalog (the layout's
  // SIDEBAR, via @/lib/demo-catalog) entirely in the browser. The agent has no
  // other way to know what demos exist, so this grounds "where do I find X"
  // answers in real data instead of invented ones.
  useFrontendTool({
    name: "search_demos",
    description:
      "Search this app's demo catalog by keyword. Returns matching demos with title, description, SDK group and url. Answer only from these results — never invent a demo or a URL.",
    parameters: z.object({
      query: z
        .string()
        .describe("Keywords, e.g. 'workflow suspend' or 'human in the loop'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Maximum number of results. Defaults to 5."),
    }),
    handler: async ({ query, limit }) => {
      const results = searchDemos(query, limit ?? 5);
      return {
        status: "success",
        query,
        count: results.length,
        results: results.map(({ id, title, description, url, group, concept }) => ({
          id,
          title,
          description,
          url,
          group,
          concept,
        })),
      };
    },
  });

  // ASYNC frontend tool: awaits a simulated browser-side fetch before returning.
  useFrontendTool({
    name: "fetch_activity_suggestion",
    description:
      "Fetch a fun activity suggestion for the user. Simulates an async browser-side lookup that takes a moment to resolve.",
    parameters: z.object({
      category: z
        .string()
        .optional()
        .describe("Optional hint for the kind of activity the user is after."),
    }),
    handler: async () => {
      // Simulate an async browser-side fetch that resolves after a delay.
      await new Promise((resolve) => setTimeout(resolve, 900));
      const suggestion =
        ACTIVITY_SUGGESTIONS[
          Math.floor(Math.random() * ACTIVITY_SUGGESTIONS.length)
        ];
      return { suggestion };
    },
  });

  // SYNC frontend tool: reads and extracts text from a file the user attached
  // in chat (plain read for text/markdown/csv/code, pdfjs-dist for PDF). The
  // File itself never leaves the browser; only the extracted text is
  // returned to the agent.
  useFrontendTool({
    name: "show_attached_file",
    description:
      "Display an attached file and read the text extracted from it. Pass 'filename' to pick a specific attachment; omit it to use the most recently attached file. Use the returned 'text' to answer questions about the file — never fabricate its contents.",
    parameters: z.object({
      filename: z
        .string()
        .optional()
        .describe(
          "The filename of the attachment to read. Omit to use the most recently attached file.",
        ),
    }),
    handler: async ({ filename }) => {
      const files = filesRef.current;
      const file = filename
        ? files.get(filename)
        : Array.from(files.values()).at(-1);

      if (!file) {
        return {
          status: "error",
          message: filename
            ? `No attached file named "${filename}" was found.`
            : "No file has been attached yet. Ask the user to attach one first.",
        };
      }

      try {
        const text = await extractFileText(file);
        return {
          status: "success",
          filename: file.name,
          mimeType: file.type || "unknown",
          size: file.size,
          characters: text.length,
          text: text.slice(0, MAX_EXTRACTED_CHARACTERS),
        };
      } catch (error) {
        return {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to read the attached file.",
        };
      }
    },
  });

  // Custom renderer for show_attached_file: shows the file card while the
  // tool runs, then the extracted-text preview (or a graceful error card).
  useRenderTool({
    name: "show_attached_file",
    parameters: z.object({
      filename: z.string().optional(),
    }),
    render: ({ status, parameters, result }) => {
      if (status !== "complete") {
        return <AttachedFileCard status={status} filename={parameters.filename} />;
      }

      const parsed = safeParseToolResult(result);
      if (parsed.status === "error") {
        return (
          <AttachedFileCard
            status="complete"
            filename={parameters.filename}
            errorMessage={
              typeof parsed.message === "string"
                ? parsed.message
                : "Failed to read the attached file."
            }
          />
        );
      }

      return (
        <AttachedFileCard
          status="complete"
          filename={typeof parsed.filename === "string" ? parsed.filename : parameters.filename}
          mimeType={typeof parsed.mimeType === "string" ? parsed.mimeType : undefined}
          size={typeof parsed.size === "number" ? parsed.size : undefined}
          characters={typeof parsed.characters === "number" ? parsed.characters : undefined}
          text={typeof parsed.text === "string" ? parsed.text : undefined}
        />
      );
    },
  });

  // Custom renderer for search_demos: shows a searching state, then a card of
  // clickable demo results.
  useRenderTool({
    name: "search_demos",
    // NOTE: args stream in incrementally, so every field must be optional
    // here even though the tool's own schema requires `query`.
    parameters: z.object({
      query: z.string().optional(),
      limit: z.number().optional(),
    }),
    render: ({ status, parameters, result }) => {
      if (status !== "complete") {
        return (
          <DemoSearchResultsCard status={status} query={parameters.query} results={[]} />
        );
      }

      const parsed = safeParseToolResult(result);
      const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
      const results = rawResults.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const record = entry as Record<string, unknown>;
        if (
          typeof record.id !== "string" ||
          typeof record.title !== "string" ||
          typeof record.url !== "string"
        ) {
          return [];
        }
        return [
          {
            id: record.id,
            title: record.title,
            url: record.url,
            description:
              typeof record.description === "string" ? record.description : undefined,
            group: typeof record.group === "string" ? record.group : undefined,
            concept: typeof record.concept === "string" ? record.concept : undefined,
          },
        ];
      });

      return (
        <DemoSearchResultsCard
          status="complete"
          query={typeof parsed.query === "string" ? parsed.query : parameters.query}
          results={results}
        />
      );
    },
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Sunset",
        message: "Change the background to a warm sunset gradient.",
        className: "frontend-tools-suggestion-sunset",
      },
      {
        title: "Forest",
        message: "Change the background to a calm forest green gradient.",
        className: "frontend-tools-suggestion-forest",
      },
      {
        title: "Ocean",
        message: "Change the background to a deep ocean blue gradient.",
        className: "frontend-tools-suggestion-ocean",
      },
      {
        title: "Toggle theme",
        message: "Toggle the theme.",
        className: "frontend-tools-suggestion-toggle-theme",
      },
      {
        title: "Toggle sidebar",
        message: "Toggle the sidebar.",
        className: "frontend-tools-suggestion-toggle-sidebar",
      },
      {
        title: "Summarize my file",
        message: "Read the file I attached and summarize it.",
        className: "frontend-tools-suggestion-summarize-file",
      },
      {
        title: "Find a demo",
        message: "Search the demo catalog for human-in-the-loop demos.",
        className: "frontend-tools-suggestion-search-demos",
      },
      {
        title: "Open search",
        message: "Open the search popup and prefill it with 'workflow'.",
        className: "frontend-tools-suggestion-open-search",
      },
      {
        title: "Pinned conversations",
        message: "List my pinned conversations.",
        className: "frontend-tools-suggestion-list-pinned",
      },
    ],
    available: "always",
  });

  return (
    <div
      className="copilotkit-frontend-tools-demo -mb-4 flex h-[calc(100%+1rem)] min-h-0 w-full flex-col overflow-hidden rounded-xl transition-colors duration-500"
      style={{ background }}
    >
      <div className="flex shrink-0 items-center gap-2 p-4 pb-0">
        <ThemeToggle />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSearchOpen(true)}
        >
          <SearchIcon />
          Search demos
          <kbd className="text-muted-foreground ml-1 text-xs">⌘K</kbd>
        </Button>
      </div>
      <DemoSearchPopup
        open={searchOpen}
        onOpenChange={setSearchOpen}
        query={searchQuery}
        onQueryChange={setSearchQuery}
      />
      <CopilotChatPanel
        // Remount on thread switch so CopilotKit connects to the new thread
        // and hydrates its persisted messages.
        key={threadId}
        agentId={agentId}
        threadId={threadId}
        containerClassName="min-h-0 flex-1"
        attachments={{
          enabled: true,
          accept: "text/*,application/pdf,.md,.csv,.json",
          maxSize: 5 * 1024 * 1024,
          onUpload: async (file: File): Promise<AttachmentUploadResult> => {
            filesRef.current.set(file.name, file);
            return {
              type: "data",
              value: await readFileAsBase64(file),
              mimeType: file.type || "application/octet-stream",
            };
          },
        }}
      />
    </div>
  );
};

/** Parses a show_attached_file tool result (JSON string) into a loose record. */
function safeParseToolResult(result: string): Record<string, unknown> {
  try {
    return JSON.parse(result) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default FrontendToolsCopilotKitDemo;
