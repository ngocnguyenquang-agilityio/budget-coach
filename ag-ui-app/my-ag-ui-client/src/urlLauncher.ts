import open from "open"

/**
 * AG-UI tool declaration for the client-side "openUrl" tool.
 * Passed into `runAgent({ tools: [openUrlTool] }, ...)` so the model knows
 * it can ask the CLI to open a link in the user's default browser.
 */
export const openUrlTool = {
  name: "openUrl",
  description:
    "Open a URL in the user's default web browser. Use for http/https links the user wants to visit.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The absolute http(s) URL to open",
      },
    },
    required: ["url"],
  },
}

/**
 * Returns true only for absolute http:// or https:// URLs.
 */
export function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Validates and opens a URL in the user's default browser.
 * Never throws — failures are reported via the returned result so they
 * can be relayed back to the model as a tool result.
 */
export async function launchUrl(
  url: string
): Promise<{ ok: boolean; message: string }> {
  if (!isValidHttpUrl(url)) {
    return {
      ok: false,
      message: `Refused to open "${url}": only absolute http/https URLs are allowed.`,
    }
  }

  try {
    await open(url)
    return { ok: true, message: `Opened ${url} in the default browser.` }
  } catch (error) {
    return {
      ok: false,
      message: `Failed to open ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
}
