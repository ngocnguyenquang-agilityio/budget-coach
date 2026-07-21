import "@copilotkit/react-core/v2/styles.css";
import { useRef, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotPopup,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { readFileAsBase64, type AttachmentUploadResult } from "@copilotkit/shared";
import { z } from "zod";
import { MASTRA_BASE_URL } from "@/constants";
import { chatInputWithoutDisclaimer } from "@/components/ck/empty-chat-disclaimer";
import { AttachedFileCard } from "@/components/ck/attached-file-card";
import { ThemeToggle } from "@/components/ck/theme-toggle";
import { useTheme } from "@/components/theme-provider";
import { useSidebar } from "@/components/ui/sidebar";
import { extractFileText } from "@/lib/extract-file-text";

/** Text the model is allowed to see per attached file, to keep prompts bounded. */
const MAX_EXTRACTED_CHARACTERS = 20_000;

const AGENT_ID = "ck_frontend_tools";

const DEFAULT_BACKGROUND = "var(--background)";

const ACTIVITY_SUGGESTIONS = [
  "Take a 10-minute walk and notice five things you have never seen before.",
  "Brew a fancy cup of tea and read one chapter of a book you love.",
  "Sketch the view outside your window, no erasing allowed.",
  "Call a friend you have not spoken to in a while, just to say hi.",
  "Try a 5-minute desk stretch routine to reset your posture.",
  "Write down three tiny wins from today, however small.",
] as const;

const FrontendToolsCopilotKitDemo = () => {
  return (
    <CopilotKit
      runtimeUrl={`${MASTRA_BASE_URL}/copilotkit`}
      agent={AGENT_ID}
    >
      <Chat />
    </CopilotKit>
  );
};

const Chat = () => {
  const [background, setBackground] = useState<string>(DEFAULT_BACKGROUND);
  const { theme, setTheme } = useTheme();
  const { state, setOpen, toggleSidebar } = useSidebar();
  // Bridges "file the user picked" (only available inside the attachments
  // onUpload callback) to "the show_attached_file tool handler" (which only
  // receives the agent's JSON args), keyed by filename.
  const filesRef = useRef<Map<string, File>>(new Map());

  // Expose the current theme so the agent can honor "toggle"/"switch" requests
  // by reading the current value and setting the opposite.
  useAgentContext({ description: "Current UI theme", value: theme });

  // Expose the current sidebar state so the agent can resolve "toggle" requests.
  useAgentContext({ description: "Current sidebar state", value: state });

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
  // ThemeProvider. The current theme is exposed via useAgentContext above so the
  // agent can resolve "toggle"/"switch" to the opposite mode.
  useFrontendTool({
    name: "set_theme",
    description:
      "Set the application's color theme. Use 'system' to follow the OS. If the user asks to toggle/switch, read the current theme from context and pick the opposite.",
    parameters: z.object({
      theme: z
        .enum(["light", "dark", "system"])
        .describe("The theme to apply."),
    }),
    handler: async ({ theme: next }) => {
      setTheme(next);
      return {
        status: "success",
        message: `Theme set to ${next}`,
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
    ],
    available: "always",
  });

  return (
    <div
      className="copilotkit-frontend-tools-demo relative -mb-4 flex h-[calc(100%+1rem)] min-h-0 w-full overflow-hidden rounded-xl transition-colors duration-500"
      style={{ background }}
    >
      <div className="absolute top-4 left-4 z-10">
        <ThemeToggle />
      </div>
      <CopilotPopup
        agentId={AGENT_ID}
        input={chatInputWithoutDisclaimer}
        defaultOpen={true}
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
