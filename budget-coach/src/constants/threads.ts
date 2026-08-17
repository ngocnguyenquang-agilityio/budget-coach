// Most browsers here will have a handful of conversations; this cap exists so the
// drawer's single request can never grow unbounded. Mastra's storage layer would
// otherwise apply its own implicit default of 100.
export const THREAD_LIST_PAGE_SIZE = 200;

// mastra_threads.title is "" until a title is generated for the thread, so the
// drawer needs something to show for a brand-new conversation.
export const UNTITLED_THREAD_LABEL = "Untitled conversation";
