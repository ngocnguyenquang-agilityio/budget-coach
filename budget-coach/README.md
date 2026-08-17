# CopilotKit <> Mastra Starter

This is a starter template for building AI agents using [Mastra](https://mastra.ai) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with integrated AI capabilities and a beautiful UI.

## Prerequisites

- Node.js 18+
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)

## Getting Started

1. Add your OpenAI API key

```bash
# you can use whatever model Mastra supports
echo "OPENAI_API_KEY=your-key-here" >> .env
```

2. Install dependencies using your preferred package manager:

```bash
# Using npm (default)
npm install

# Using pnpm
pnpm install

# Using yarn
yarn install

# Using bun
bun install
```

3. Start the development server:

```bash
# Using npm (default)
npm run dev

# Using pnpm
pnpm dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This will start both the UI and agent servers concurrently.

## Running a Channel

`channel-host.mts` mounts the same agent as an Intelligence Channel
(Slack, Teams). It requires `INTELLIGENCE_API_KEY` and a declared Channel in
`.copilotkit/channels.json` — set both up with `copilotkit init` or
`copilotkit channels add`, which write that file and the credentials your
`.env` needs, then:

```bash
npm run channel
```

The host reads which Channel to hold from `.copilotkit/channels.json`. If a
project declares more than one, set `INTELLIGENCE_CHANNEL_NAME` to pick one.

The host holds no provider credentials and exposes no provider endpoint —
Intelligence owns the provider edge — so the same file works for every provider.

The Channel itself is declared in `channels.mts` — that is where to add commands,
reactions, or an `onMention` handler. `channel-host.mts` only owns the process
lifetime, and is byte-identical in every starter.

Once startup finishes, the log reports the truth per Channel:

- `Channel "<name>" is online.` — the session is up and can send.
- `Channel "<name>" is declared but no provider is attached yet.` —
  a normal waiting state, not a failure. Run `copilotkit channels status` to
  see what setup remains.

Neither message proves the provider app is installed, reachable, or that
anyone can message it — verify that separately (invite the bot, then message
it) before treating the Channel as working.

Unlike the other starters, this one has no `typecheck:channel` script: the
host's import chain reaches `src/mastra/**`, which carries a pre-existing
type error unrelated to the Channel host (see the comment in
`tsconfig.channel.json`).

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the Mastra agent server
- `dev:debug` - Starts development servers with debug logging enabled
- `build` - Builds the application for production
- `start` - Starts the production server
- `channel` - Holds an Intelligence Channel open (see "Running a Channel" above)

## Documentation

- [Mastra Documentation](https://mastra.ai/en/docs) - Learn more about Mastra and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Conversation threads

Thread history is durable and needs no CopilotKit license or extra
infrastructure. Every conversation is stored by Mastra memory in LibSQL
(`mastra_threads` / `mastra_messages`), scoped to the per-browser `resourceId`
cookie that `src/middleware.ts` sets.

- `src/components/threads-drawer.tsx` renders the conversation list, backed by
  `/api/threads` (list, rename, delete) and `/api/threads/:id/title`.
- `src/mastra/agui-replay-runner.ts` rebuilds a thread's transcript — messages,
  tool calls and their results — when the chat reconnects to it, so history
  survives cold starts, redeploys and instance churn.
- `pnpm backfill:titles --dry-run` names any thread created before titles were
  stored in Mastra.

This app deliberately does **not** use CopilotKit Intelligence. Its runner
returns the HTTP response as soon as its WebSocket to the gateway joins and then
runs the agent in the background, which a serverless platform freezes the moment
the response is sent — on Vercel every run failed with
`RUNNER_CONNECTION_DROPPED`. `COPILOTKIT_LICENSE_TOKEN` and `INTELLIGENCE_*` are
read nowhere in this codebase; setting them changes nothing.
