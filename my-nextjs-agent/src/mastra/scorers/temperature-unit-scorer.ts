import { createScorer } from '@mastra/core/evals';
import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';
import type { MastraDBMessage } from '@mastra/core/memory';

type PreferredUnit = 'celsius' | 'fahrenheit';

type PreprocessResult = {
  preferredUnit: PreferredUnit;
  toolCelsius: number | null;
  responseText: string;
};

type AnalyzeResult = {
  preferredUnit: PreferredUnit;
  reportedUnit: PreferredUnit | null;
  reportedValue: number | null;
  expectedValue: number | null;
  unitMatches: boolean | null;
  valueWithinTolerance: boolean | null;
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

// Finds the most recent tool-invocation result for `toolName` across a chronological
// run of messages (last match wins, since the arrays are oldest-first).
function getLatestToolResult(
  messages: MastraDBMessage[],
  toolName: string,
): Record<string, unknown> | null {
  let latest: Record<string, unknown> | null = null;

  for (const message of messages) {
    for (const part of message.content.parts ?? []) {
      if (part.type !== 'tool-invocation') continue;

      const invocation = part.toolInvocation;
      if (invocation.toolName !== toolName) continue;
      if (invocation.state !== 'result') continue;

      latest = invocation.result as Record<string, unknown>;
    }
  }

  return latest;
}

function getToolCelsius(output: ScorerRunOutputForAgent): number | null {
  // Registered under the `weatherTool` key in weatherAgent's `tools` map (weather-agent.ts) —
  // that key, not the tool's own `id: 'get-weather'`, is what shows up as `toolName` here.
  const result = getLatestToolResult(output, 'weatherTool');
  return typeof result?.temperature === 'number' ? result.temperature : null;
}

// The saved preference isn't reliably present in `run.input.systemMessages` at scoring
// time (working-memory injection can happen after the message list snapshot the scorer
// sees is captured), so read it from the `setTemperatureUnitTool` call itself — the tool
// that actually persists it — which is the real source of truth either way.
function getPreferredUnit(input: ScorerRunInputForAgent, output: ScorerRunOutputForAgent): PreferredUnit {
  const history = [...input.rememberedMessages, ...input.inputMessages, ...output];
  const result = getLatestToolResult(history, 'setTemperatureUnitTool');
  return result?.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
}

function extractStatedTemperature(
  responseText: string,
): { unit: PreferredUnit; value: number } | null {
  const match = responseText.match(/(-?\d+(?:\.\d+)?)\s*°?\s*(celsius|fahrenheit|c|f)\b/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  const rawUnit = match[2].toLowerCase();
  const unit: PreferredUnit = rawUnit.startsWith('f') ? 'fahrenheit' : 'celsius';

  return { unit, value };
}

export const temperatureUnitScorer = createScorer({
  id: 'temperature-unit-compliance',
  description:
    "Checks that a weather-agent response states temperature in the user's saved unit preference, and that °F values are converted correctly from the tool's raw Celsius reading.",
  type: 'agent',
})
  .preprocess(({ run }): PreprocessResult => {
    const output = run.output as ScorerRunOutputForAgent;
    const input = run.input as ScorerRunInputForAgent;

    return {
      preferredUnit: getPreferredUnit(input, output),
      toolCelsius: getToolCelsius(output),
      responseText: getResponseText(output),
    };
  })
  .analyze(({ results }): AnalyzeResult => {
    const { preferredUnit, toolCelsius, responseText } = results.preprocessStepResult;
    const stated = extractStatedTemperature(responseText);

    if (!stated) {
      return {
        preferredUnit,
        reportedUnit: null,
        reportedValue: null,
        expectedValue: null,
        unitMatches: null,
        valueWithinTolerance: null,
      };
    }

    const unitMatches = stated.unit === preferredUnit;

    let expectedValue: number | null = null;
    let valueWithinTolerance: boolean | null = null;

    if (toolCelsius !== null) {
      expectedValue =
        preferredUnit === 'fahrenheit' ? (toolCelsius * 9) / 5 + 32 : toolCelsius;
      valueWithinTolerance = Math.abs(stated.value - expectedValue) <= 1;
    }

    return {
      preferredUnit,
      reportedUnit: stated.unit,
      reportedValue: stated.value,
      expectedValue,
      unitMatches,
      valueWithinTolerance,
    };
  })
  .generateScore(({ results }) => {
    const { reportedUnit, unitMatches, valueWithinTolerance, expectedValue } =
      results.analyzeStepResult;

    // No stated temperature this turn (e.g. agent asked for a location) — nothing to violate.
    if (reportedUnit === null) return 1;

    if (!unitMatches) return 0;

    // Unit matched but there's no tool reading to check the number against.
    if (expectedValue === null) return 0.5;

    return valueWithinTolerance ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const { preferredUnit, reportedUnit, reportedValue, expectedValue, unitMatches } =
      results.analyzeStepResult;

    if (reportedUnit === null) {
      return `Score: ${score}. Response stated no temperature, so there was nothing to check.`;
    }

    if (!unitMatches) {
      return `Score: ${score}. Response stated ${reportedUnit}, but the saved preference is ${preferredUnit}.`;
    }

    if (expectedValue === null) {
      return `Score: ${score}. Response correctly used ${preferredUnit}, but no tool reading was available to verify the value ${reportedValue}.`;
    }

    return `Score: ${score}. Response stated ${reportedValue}°${preferredUnit === 'fahrenheit' ? 'F' : 'C'}, expected approximately ${expectedValue.toFixed(1)}.`;
  });
