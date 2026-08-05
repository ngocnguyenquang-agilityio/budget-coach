import { createScorer } from '@mastra/core/evals';
import type { ScorerRunOutputForAgent } from '@mastra/core/evals';
import type { MastraDBMessage } from '@mastra/core/memory';

type PreprocessResult = {
  weatherToolIndex: number;
  guideToolIndex: number;
  firstTextIndex: number;
};

type AnalyzeResult = {
  weatherCalled: boolean;
  weatherBeforeText: boolean;
  guideCalled: boolean;
  guideInCorrectOrder: boolean;
};

type FlatPart = { kind: 'tool'; toolName: string } | { kind: 'text' };

// Tool names here are the agent's `tools` map registration keys
// (askWeatherAgentTool, searchDestinationGuideTool), not the tools'
// own `id` fields (ask-weather-agent, search-destination-guide) —
// see the same note in temperature-unit-scorer.ts.
function flattenParts(messages: MastraDBMessage[]): FlatPart[] {
  const parts: FlatPart[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    for (const part of message.content.parts ?? []) {
      if (part.type === 'tool-invocation' && part.toolInvocation.state === 'result') {
        parts.push({ kind: 'tool', toolName: part.toolInvocation.toolName });
      } else if (part.type === 'text') {
        parts.push({ kind: 'text' });
      }
    }
  }

  return parts;
}

function firstIndexOfTool(parts: FlatPart[], toolName: string): number {
  return parts.findIndex(part => part.kind === 'tool' && part.toolName === toolName);
}

function firstIndexOfText(parts: FlatPart[]): number {
  return parts.findIndex(part => part.kind === 'text');
}

export const tripToolUsageScorer = createScorer({
  id: 'trip-tool-usage',
  description:
    "Checks that the trip-planner agent called askWeatherAgentTool before writing itinerary text, and called searchDestinationGuideTool (if at all) after the weather tool and before any itinerary text.",
  type: 'agent',
})
  .preprocess(({ run }): PreprocessResult => {
    const output = run.output as ScorerRunOutputForAgent;
    const parts = flattenParts(output);

    return {
      weatherToolIndex: firstIndexOfTool(parts, 'askWeatherAgentTool'),
      guideToolIndex: firstIndexOfTool(parts, 'searchDestinationGuideTool'),
      firstTextIndex: firstIndexOfText(parts),
    };
  })
  .analyze(({ results }): AnalyzeResult => {
    const { weatherToolIndex, guideToolIndex, firstTextIndex } = results.preprocessStepResult;

    const weatherCalled = weatherToolIndex !== -1;
    const weatherBeforeText = weatherCalled && (firstTextIndex === -1 || weatherToolIndex < firstTextIndex);
    const guideCalled = guideToolIndex !== -1;
    // The guide tool must run in the window after weather and before any
    // itinerary text — comparing only against weatherToolIndex can't tell
    // "guide called between weather and text" (fine) apart from "guide
    // called after text already started" (a real ordering violation).
    const guideInCorrectOrder =
      !guideCalled ||
      (weatherCalled &&
        guideToolIndex > weatherToolIndex &&
        (firstTextIndex === -1 || guideToolIndex < firstTextIndex));

    return { weatherCalled, weatherBeforeText, guideCalled, guideInCorrectOrder };
  })
  .generateScore(({ results }) => {
    const { weatherCalled, weatherBeforeText, guideInCorrectOrder } = results.analyzeStepResult;

    if (!weatherCalled || !weatherBeforeText) return 0;
    if (!guideInCorrectOrder) return 0.5;
    return 1;
  })
  .generateReason(({ results, score }) => {
    const { weatherCalled, weatherBeforeText, guideCalled, guideInCorrectOrder } = results.analyzeStepResult;

    if (!weatherCalled) {
      return `Score: ${score}. askWeatherAgentTool was never called.`;
    }

    if (!weatherBeforeText) {
      return `Score: ${score}. askWeatherAgentTool was called after itinerary text had already started.`;
    }

    if (guideCalled && !guideInCorrectOrder) {
      return `Score: ${score}. searchDestinationGuideTool was called out of order — it must run after askWeatherAgentTool and before itinerary text.`;
    }

    return `Score: ${score}. Tool call order was correct (weather before text${guideCalled ? ', guide between weather and text' : ', guide not called'}).`;
  });
