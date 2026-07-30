import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const setTemperatureUnitTool = createTool({
  id: 'set-temperature-unit',
  description:
    "Save the user's preferred temperature unit (celsius or fahrenheit) so future weather responses use it.",
  inputSchema: z.object({
    unit: z.enum(['celsius', 'fahrenheit']).describe('The temperature unit the user prefers'),
  }),
  outputSchema: z.object({
    unit: z.enum(['celsius', 'fahrenheit']),
    saved: z.boolean(),
  }),
  execute: async (inputData, context) => {
    const threadId = context.agent?.threadId;
    const resourceId = context.agent?.resourceId;

    if (!threadId) {
      throw new Error('setTemperatureUnitTool requires a threadId (must be called within an agent run)');
    }

    const agent = context.mastra?.getAgentById('weather-agent');
    const memory = await agent?.getMemory();

    if (!memory) {
      throw new Error('weather-agent has no Memory instance configured');
    }

    await memory.updateWorkingMemory({
      threadId,
      resourceId,
      workingMemory: `# Preferences\n- Temperature Unit: ${inputData.unit}`,
    });

    return { unit: inputData.unit, saved: true };
  },
});
