// Next.js loads .env itself, but a bare tsx script does not — without this the
// storage layer falls back to the local file DB (file:./budget-coach.db) and
// would "backfill" stale dev threads instead of the real ones in Turso.
import "dotenv/config";
import { getCoachMemory } from "../src/mastra/threads";
import { generateThreadTitle } from "../src/mastra/thread-naming";
import { THREAD_LIST_PAGE_SIZE } from "../src/constants/threads";

// Threads created before titles were stored in Mastra have title = "" — naming
// used to write to the Intelligence platform instead. This gives them one.
//
// Usage:
//   pnpm backfill:titles --dry-run       # list what would be titled
//   pnpm backfill:titles                 # title every untitled thread
//   pnpm backfill:titles <resourceId>    # limit to one browser's threads
//
// Note this runs against whatever TURSO_DATABASE_URL points at — which for this
// project is the same database production uses — and makes one LLM call per
// thread. Start with --dry-run.

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const resourceId = args.find((arg) => !arg.startsWith("--"));

  const memory = await getCoachMemory();
  const { threads } = await memory.listThreads({
    ...(resourceId ? { filter: { resourceId } } : {}),
    perPage: THREAD_LIST_PAGE_SIZE,
    page: 0,
  });

  const untitled = threads.filter((thread) => !thread.title?.trim());
  console.log(
    `${threads.length} thread(s) found, ${untitled.length} untitled${
      dryRun ? " (dry run — nothing will be written)" : ""
    }.`,
  );

  for (const thread of untitled) {
    if (dryRun) {
      console.log(`  would title ${thread.id} (resource ${thread.resourceId})`);
      continue;
    }

    // Sequential on purpose: one LLM call at a time keeps this from tripping
    // provider rate limits on a large backlog.
    const title = await generateThreadTitle({
      threadId: thread.id,
      resourceId: thread.resourceId,
    });

    console.log(
      title
        ? `  ${thread.id}: "" -> "${title}"`
        : `  ${thread.id}: skipped (no user message to summarize)`,
    );
  }
};

main();
