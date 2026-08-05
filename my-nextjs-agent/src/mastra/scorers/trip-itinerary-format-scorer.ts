import { createScorer } from '@mastra/core/evals';
import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';

type PreprocessResult = {
  requestedDayCount: number | null;
  responseText: string;
};

type AnalyzeResult = {
  requestedDayCount: number | null;
  headersFound: number;
  wellFormedDayBlocks: number;
  closingNoteCount: number;
  closingNoteAfterLastDay: boolean;
};

function getResponseText(messages: ScorerRunOutputForAgent): string {
  let text = '';

  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    for (const part of message.content.parts ?? []) {
      if (part.type === 'text' && typeof part.text === 'string') {
        text += part.text;
      }
    }
  }

  return text;
}

function getUserText(input: ScorerRunInputForAgent): string {
  let text = '';

  for (const message of [...input.rememberedMessages, ...input.inputMessages]) {
    if (message.role !== 'user') continue;

    for (const part of message.content.parts ?? []) {
      if (part.type === 'text' && typeof part.text === 'string') {
        text += ` ${part.text}`;
      }
    }
  }

  return text;
}

function extractRequestedDayCount(userText: string): number | null {
  const match = userText.match(/(\d+)\s*[- ]?day/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

const DAY_HEADER_ONLY_RE = /🧳 Day \d+/gu;
const DAY_HEADER_RE = /🧳 Day \d+ — [^\n]*\n═+\nMorning: [^\n]*\nAfternoon: [^\n]*\nEvening: [^\n]*/gu;
const CLOSING_NOTE_RE = /⚠️ NOTE/gu;

export const tripItineraryFormatScorer = createScorer({
  id: 'trip-itinerary-format',
  description:
    "Checks that a trip-planner response has the exact requested number of days, each day block fully formatted (header, separator, Morning/Afternoon/Evening lines), and exactly one closing NOTE section after the last day.",
  type: 'agent',
})
  .preprocess(({ run }): PreprocessResult => {
    const input = run.input as ScorerRunInputForAgent;
    const output = run.output as ScorerRunOutputForAgent;

    return {
      requestedDayCount: extractRequestedDayCount(getUserText(input)),
      responseText: getResponseText(output),
    };
  })
  .analyze(({ results }): AnalyzeResult => {
    const { requestedDayCount, responseText } = results.preprocessStepResult;

    const headersFound = (responseText.match(DAY_HEADER_ONLY_RE) ?? []).length;
    const wellFormedDayBlocks = (responseText.match(DAY_HEADER_RE) ?? []).length;

    const noteMatches = [...responseText.matchAll(CLOSING_NOTE_RE)];
    const closingNoteCount = noteMatches.length;

    let closingNoteAfterLastDay = false;
    if (closingNoteCount > 0) {
      const dayHeaderIndexes = [...responseText.matchAll(DAY_HEADER_ONLY_RE)].map(match => match.index ?? -1);
      const lastDayHeaderIndex = dayHeaderIndexes.reduce((max, index) => Math.max(max, index), -1);
      const firstNoteIndex = noteMatches[0].index ?? -1;
      closingNoteAfterLastDay = firstNoteIndex > lastDayHeaderIndex;
    }

    return {
      requestedDayCount,
      headersFound,
      wellFormedDayBlocks,
      closingNoteCount,
      closingNoteAfterLastDay,
    };
  })
  .generateScore(({ results }) => {
    const { requestedDayCount, headersFound, wellFormedDayBlocks, closingNoteCount, closingNoteAfterLastDay } =
      results.analyzeStepResult;

    if (requestedDayCount !== null && headersFound !== requestedDayCount) return 0;

    const allWellFormed = wellFormedDayBlocks === headersFound;
    const noteOk = closingNoteCount === 1 && closingNoteAfterLastDay;

    return allWellFormed && noteOk ? 1 : 0.5;
  })
  .generateReason(({ results, score }) => {
    const { requestedDayCount, headersFound, wellFormedDayBlocks, closingNoteCount, closingNoteAfterLastDay } =
      results.analyzeStepResult;

    if (requestedDayCount !== null && headersFound !== requestedDayCount) {
      return `Score: ${score}. Requested ${requestedDayCount} days but found ${headersFound} day headers.`;
    }

    if (wellFormedDayBlocks !== headersFound) {
      return `Score: ${score}. ${headersFound - wellFormedDayBlocks} of ${headersFound} day blocks are missing required lines (separator/Morning/Afternoon/Evening).`;
    }

    if (closingNoteCount !== 1) {
      return `Score: ${score}. Expected exactly one closing NOTE section, found ${closingNoteCount}.`;
    }

    if (!closingNoteAfterLastDay) {
      return `Score: ${score}. Closing NOTE section appears before the last day block.`;
    }

    return `Score: ${score}. Response has ${headersFound} well-formed day blocks and one correctly placed closing NOTE.`;
  });
