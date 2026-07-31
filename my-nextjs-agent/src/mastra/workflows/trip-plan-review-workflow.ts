import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { tripPlannerAgent } from '../agents/trip-planner-agent'
import { RESOURCE_ID } from '../constants'

const loopSchema = z.object({
  city: z.string(),
  days: z.number(),
  threadId: z.string(),
  itinerary: z.string().optional(),
  decision: z.enum(['approve', 'revise', 'discard']).optional(),
  feedback: z.string().optional(),
})

const draftItinerary = createStep({
  id: 'draft-itinerary',
  description: 'Drafts (or redrafts, given feedback) a trip itinerary for human review',
  inputSchema: loopSchema,
  outputSchema: loopSchema,
  execute: async ({ inputData, writer }) => {
    const { city, days, threadId, feedback } = inputData

    let prompt = `Plan a ${days}-day trip to ${city}.`
    if (feedback) {
      prompt += ` Revise the previous itinerary based on this feedback: ${feedback}`
    }

    const response = await tripPlannerAgent.stream([{ role: 'user', content: prompt }])

    let itinerary = ''
    for await (const chunk of response.textStream) {
      itinerary += chunk
      await writer.write({ type: 'text-delta', payload: { id: 'draft-itinerary', text: chunk } })
    }

    return { city, days, threadId, itinerary, decision: undefined, feedback: undefined }
  },
})

const reviewGate = createStep({
  id: 'review-gate',
  description: 'Suspends the workflow until a human approves, requests changes, or discards the draft',
  inputSchema: loopSchema,
  outputSchema: loopSchema,
  suspendSchema: z.object({ itinerary: z.string() }),
  resumeSchema: z.object({
    decision: z.enum(['approve', 'revise', 'discard']),
    feedback: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({ itinerary: inputData.itinerary ?? '' })
    }

    return { ...inputData, ...resumeData }
  },
})

const draftAndReview = createWorkflow({
  id: 'draft-and-review',
  inputSchema: loopSchema,
  outputSchema: loopSchema,
})
  .then(draftItinerary)
  .then(reviewGate)

draftAndReview.commit()

const finalize = createStep({
  id: 'finalize',
  description: 'Persists the itinerary to thread memory if approved, discards it otherwise',
  inputSchema: loopSchema,
  outputSchema: z.object({
    itinerary: z.string(),
    status: z.enum(['saved', 'discarded']),
  }),
  execute: async ({ inputData, mastra }) => {
    const { itinerary, decision, threadId } = inputData

    if (decision === 'approve' && itinerary) {
      const memory = await mastra.getAgentById('weather-agent').getMemory()
      if (memory) {
        await memory.saveMessages({
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              createdAt: new Date(),
              threadId,
              resourceId: RESOURCE_ID,
              content: {
                format: 2,
                parts: [{ type: 'text', text: itinerary }],
              },
            },
          ],
        })
      }
      return { itinerary, status: 'saved' as const }
    }

    return { itinerary: itinerary ?? '', status: 'discarded' as const }
  },
})

export const tripPlanReviewWorkflow = createWorkflow({
  id: 'trip-plan-review-workflow',
  inputSchema: z.object({
    city: z.string().describe('The city to plan a trip to'),
    days: z.number().describe('Number of days in the itinerary'),
    threadId: z.string().describe('Chat thread to persist the approved itinerary to'),
  }),
  outputSchema: z.object({
    itinerary: z.string(),
    status: z.enum(['saved', 'discarded']),
  }),
})
  .dowhile(draftAndReview, async ({ inputData }) => inputData.decision === 'revise')
  .then(finalize)

tripPlanReviewWorkflow.commit()
