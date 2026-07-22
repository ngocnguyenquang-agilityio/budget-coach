/**
 * Human-in-the-loop policy for client-resolved tool calls.
 *
 * Every client tool the model can call (see index.ts's `pendingToolCalls`
 * resolution loop) is looked up here before it runs. Tools with side effects
 * (opening a URL, hitting the weather API) require an explicit y/N from the
 * user; pure computation (calculate) does not.
 */
export interface ToolPolicy {
  requiresConfirmation: boolean
  /** Builds the y/N prompt shown to the user for this tool call's args. */
  buildPrompt?: (args: any) => string
}

export const toolPolicies: Record<string, ToolPolicy> = {
  openUrl: {
    requiresConfirmation: true,
    buildPrompt: (args) => `Open ${args?.url} ? [y/N] `,
  },
  weather: {
    requiresConfirmation: true,
    buildPrompt: (args) => `Fetch weather for "${args?.location}" ? [y/N] `,
  },
  calculate: {
    requiresConfirmation: false,
  },
}

/**
 * Asks the user to confirm a pending tool call via the given yes/no prompter.
 * Tools with no policy entry, or a policy that doesn't require confirmation,
 * are auto-approved.
 */
export async function confirmToolCall(
  toolCallName: string,
  args: any,
  askConfirm: (question: string) => Promise<boolean>
): Promise<boolean> {
  const policy = toolPolicies[toolCallName]
  if (!policy?.requiresConfirmation) return true
  const question = policy.buildPrompt?.(args) ?? `Allow "${toolCallName}"? [y/N] `
  return askConfirm(question)
}
