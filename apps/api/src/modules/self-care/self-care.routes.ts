import {
  getTodayDate,
  selfCareAnalyticsResponseSchema,
  selfCareCompletionInputSchema,
  selfCareCompletionSchema,
  selfCareCompletionUpdateInputSchema,
  selfCareDailyStateInputSchema,
  selfCareDailyStateSchema,
  selfCareDashboardResponseSchema,
  selfCareDateQuerySchema,
  selfCareHistoryResponseSchema,
  selfCareItemInputSchema,
  selfCareItemScheduleInputSchema,
  selfCareItemSchema,
  selfCareItemUpdateInputSchema,
  selfCareListQuerySchema,
  selfCareListResponseSchema,
  selfCareMinimumItemsUpdateInputSchema,
  selfCareOccurrenceMoveInputSchema,
  selfCareOccurrenceSchema,
  selfCareOccurrenceSkipInputSchema,
  selfCarePlanResponseSchema,
  selfCareRangeQuerySchema,
  selfCareRitualCompletionInputSchema,
  selfCareRitualStepDraftInputSchema,
  selfCareRitualStepDraftListResponseSchema,
  selfCareRitualStepInputSchema,
  selfCareSettingsResponseSchema,
  selfCareSettingsUpdateInputSchema,
  selfCareTemplateCreateInputSchema,
  selfCareTemplateSchema,
} from '@planner/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import {
  resolveRouteReadContext,
  resolveRouteWriteContext,
} from '../../bootstrap/route-context.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from '../session/index.js'
import type { SelfCareService } from './self-care.service.js'

const itemParamsSchema = z.object({ itemId: z.string().min(1) })
const completionParamsSchema = z.object({ completionId: z.string().min(1) })
const occurrenceParamsSchema = z.object({ occurrenceId: z.string().min(1) })
const templateParamsSchema = z.object({ templateId: z.string().min(1) })
const stepsInputSchema = z.object({
  steps: z.array(selfCareRitualStepInputSchema),
})
const ritualStepDraftDeleteQuerySchema = z.object({
  date: z.string().min(1),
  itemId: z.string().min(1),
  occurrenceId: z.string().min(1).optional(),
})

export function registerSelfCareRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  service: SelfCareService,
): void {
  const getRouteDate = (
    date: string | undefined,
    timeZone: string | undefined,
  ) => date ?? getTodayDate(timeZone ?? 'UTC')

  app.get('/api/v1/self-care', async (request) => {
    const query = parseOrThrow(
      selfCareListQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.listItems(context, query)
    return selfCareListResponseSchema.parse(result)
  })

  app.get('/api/v1/self-care/dashboard', async (request) => {
    const query = parseOrThrow(
      selfCareDateQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getDashboard(
      context,
      getRouteDate(query.date, context.clientTimeZone),
    )
    return selfCareDashboardResponseSchema.parse(result)
  })

  app.get('/api/v1/self-care/plan', async (request) => {
    const query = parseOrThrow(
      selfCareRangeQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getPlan(context, query.from, query.to)
    return selfCarePlanResponseSchema.parse(result)
  })

  app.get('/api/v1/self-care/occurrences', async (request) => {
    const query = parseOrThrow(
      selfCareRangeQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getOccurrences(context, query.from, query.to)
    return z.array(selfCareOccurrenceSchema).parse(result)
  })

  app.get('/api/v1/self-care/ritual-step-drafts', async (request) => {
    const query = parseOrThrow(
      selfCareDateQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getRitualStepDrafts(
      context,
      getRouteDate(query.date, context.clientTimeZone),
    )
    return selfCareRitualStepDraftListResponseSchema.parse(result)
  })

  app.get('/api/v1/self-care/history', async (request) => {
    const query = parseOrThrow(
      selfCareRangeQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getHistory(context, query.from, query.to)
    return selfCareHistoryResponseSchema.parse(result)
  })

  app.get('/api/v1/self-care/analytics', async (request) => {
    const query = parseOrThrow(
      selfCareRangeQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getAnalytics(context, query.from, query.to)
    return selfCareAnalyticsResponseSchema.parse(result)
  })

  app.get('/api/v1/self-care/daily-state', async (request) => {
    const query = parseOrThrow(
      selfCareDateQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getDailyState(
      context,
      getRouteDate(query.date, context.clientTimeZone),
    )
    return result === null ? null : selfCareDailyStateSchema.parse(result)
  })

  app.get('/api/v1/self-care/settings', async (request) => {
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.getSettings(context)
    return selfCareSettingsResponseSchema.parse(result)
  })

  app.get('/api/v1/self-care/templates', async (request) => {
    const context = await resolveRouteReadContext(request, sessionService)
    const result = await service.listTemplates(context)
    return z.array(selfCareTemplateSchema).parse(result)
  })

  app.post('/api/v1/self-care', async (request, reply) => {
    const input = parseOrThrow(
      selfCareItemInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const item = await service.createItem(context, input)
    reply.code(201)
    return selfCareItemSchema.parse(item)
  })

  app.patch('/api/v1/self-care/:itemId', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      selfCareItemUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const item = await service.updateItem(context, params.itemId, input)
    return selfCareItemSchema.parse(item)
  })

  app.post('/api/v1/self-care/:itemId/archive', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const item = await service.archiveItem(context, params.itemId)
    return selfCareItemSchema.parse(item)
  })

  app.post('/api/v1/self-care/:itemId/restore', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const item = await service.restoreItem(context, params.itemId)
    return selfCareItemSchema.parse(item)
  })

  app.delete('/api/v1/self-care/:itemId', async (request, reply) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    await service.deleteItem(context, params.itemId)
    reply.code(204)
    return null
  })

  app.post('/api/v1/self-care/generate-occurrences', async (request) => {
    const input = parseOrThrow(
      selfCareRangeQuerySchema,
      request.body,
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const occurrences = await service.generateOccurrences(
      context,
      input.from,
      input.to,
    )
    return z.array(selfCareOccurrenceSchema).parse(occurrences)
  })

  app.post('/api/v1/self-care/items/:itemId/schedule', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      selfCareItemScheduleInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const occurrence = await service.scheduleItem(context, params.itemId, input)
    return selfCareOccurrenceSchema.parse(occurrence)
  })

  app.post(
    '/api/v1/self-care/occurrences/:occurrenceId/complete',
    async (request) => {
      const params = parseOrThrow(
        occurrenceParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        selfCareRitualCompletionInputSchema,
        request.body ?? {},
        'invalid_body',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const completion = await service.completeOccurrence(
        context,
        params.occurrenceId,
        input,
      )
      return selfCareCompletionSchema.parse(completion)
    },
  )

  app.post('/api/v1/self-care/items/:itemId/complete-now', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      selfCareRitualCompletionInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const completion = await service.completeItemNow(
      context,
      params.itemId,
      input,
    )
    return selfCareCompletionSchema.parse(completion)
  })

  app.post(
    '/api/v1/self-care/items/:itemId/complete-flexible-goal',
    async (request) => {
      const params = parseOrThrow(
        itemParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        selfCareCompletionInputSchema,
        request.body ?? {},
        'invalid_body',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const completion = await service.completeFlexibleGoal(
        context,
        params.itemId,
        input,
      )
      return selfCareCompletionSchema.parse(completion)
    },
  )

  app.post(
    '/api/v1/self-care/items/:itemId/complete-course-session',
    async (request) => {
      const params = parseOrThrow(
        itemParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        selfCareCompletionInputSchema,
        request.body ?? {},
        'invalid_body',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const completion = await service.completeCourseSession(
        context,
        params.itemId,
        input,
      )
      return selfCareCompletionSchema.parse(completion)
    },
  )

  app.patch('/api/v1/self-care/completions/:completionId', async (request) => {
    const params = parseOrThrow(
      completionParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      selfCareCompletionUpdateInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const completion = await service.updateCompletion(
      context,
      params.completionId,
      input,
    )
    return selfCareCompletionSchema.parse(completion)
  })

  app.post(
    '/api/v1/self-care/occurrences/:occurrenceId/skip',
    async (request) => {
      const params = parseOrThrow(
        occurrenceParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        selfCareOccurrenceSkipInputSchema,
        request.body ?? {},
        'invalid_body',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const occurrence = await service.skipOccurrence(
        context,
        params.occurrenceId,
        input,
      )
      return selfCareOccurrenceSchema.parse(occurrence)
    },
  )

  app.post(
    '/api/v1/self-care/occurrences/:occurrenceId/move',
    async (request) => {
      const params = parseOrThrow(
        occurrenceParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        selfCareOccurrenceMoveInputSchema,
        request.body ?? {},
        'invalid_body',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const occurrence = await service.moveOccurrence(
        context,
        params.occurrenceId,
        input,
      )
      return selfCareOccurrenceSchema.parse(occurrence)
    },
  )

  app.post(
    '/api/v1/self-care/occurrences/:occurrenceId/cancel',
    async (request) => {
      const params = parseOrThrow(
        occurrenceParamsSchema,
        request.params,
        'invalid_params',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const occurrence = await service.cancelOccurrence(
        context,
        params.occurrenceId,
      )
      return selfCareOccurrenceSchema.parse(occurrence)
    },
  )

  app.put('/api/v1/self-care/items/:itemId/steps', async (request) => {
    const params = parseOrThrow(
      itemParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      stepsInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.updateRitualSteps(
      context,
      params.itemId,
      input.steps,
    )
    return selfCareListResponseSchema.parse(result)
  })

  app.put('/api/v1/self-care/ritual-step-drafts', async (request) => {
    const input = parseOrThrow(
      selfCareRitualStepDraftInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.upsertRitualStepDraft(context, input)
    return selfCareRitualStepDraftListResponseSchema.parse(result)
  })

  app.delete('/api/v1/self-care/ritual-step-drafts', async (request) => {
    const query = parseOrThrow(
      ritualStepDraftDeleteQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.deleteRitualStepDraft(
      context,
      query.date,
      query.itemId,
      query.occurrenceId ?? null,
    )
    return selfCareRitualStepDraftListResponseSchema.parse(result)
  })

  app.put('/api/v1/self-care/daily-state', async (request) => {
    const query = parseOrThrow(
      selfCareDateQuerySchema,
      request.query,
      'invalid_query',
    )
    const input = parseOrThrow(
      selfCareDailyStateInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const state = await service.upsertDailyState(
      context,
      getRouteDate(query.date, context.clientTimeZone),
      input,
    )
    return selfCareDailyStateSchema.parse(state)
  })

  app.patch('/api/v1/self-care/settings', async (request) => {
    const input = parseOrThrow(
      selfCareSettingsUpdateInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.updateSettings(context, input)
    return selfCareSettingsResponseSchema.parse(result)
  })

  app.post('/api/v1/self-care/settings/gentle-mode/enable', async (request) => {
    const query = parseOrThrow(
      selfCareDateQuerySchema,
      request.query,
      'invalid_query',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.enableGentleMode(
      context,
      getRouteDate(query.date, context.clientTimeZone),
    )
    return selfCareSettingsResponseSchema.parse(result)
  })

  app.post(
    '/api/v1/self-care/settings/gentle-mode/disable',
    async (request) => {
      const query = parseOrThrow(
        selfCareDateQuerySchema,
        request.query,
        'invalid_query',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const result = await service.disableGentleMode(
        context,
        getRouteDate(query.date, context.clientTimeZone),
      )
      return selfCareSettingsResponseSchema.parse(result)
    },
  )

  app.put('/api/v1/self-care/settings/minimum-items', async (request) => {
    const input = parseOrThrow(
      selfCareMinimumItemsUpdateInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const context = await resolveRouteWriteContext(request, sessionService)
    const result = await service.updateMinimumItems(context, input)
    return selfCareSettingsResponseSchema.parse(result)
  })

  app.post(
    '/api/v1/self-care/templates/:templateId/create',
    async (request, reply) => {
      const params = parseOrThrow(
        templateParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        selfCareTemplateCreateInputSchema,
        request.body ?? {},
        'invalid_body',
      )
      const context = await resolveRouteWriteContext(request, sessionService)
      const item = await service.createItemFromTemplate(
        context,
        params.templateId,
        input,
      )
      reply.code(201)
      return selfCareItemSchema.parse(item)
    },
  )
}
