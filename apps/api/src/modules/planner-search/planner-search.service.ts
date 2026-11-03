import type {
  PlannerSearchItem,
  PlannerSearchQuery,
  PlannerSearchResponse,
  PlannerSearchSource,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { ChaosInboxService } from '../chaos-inbox/chaos-inbox.service.js'
import type { CleaningService } from '../cleaning/cleaning.service.js'
import type { SelfCareService } from '../self-care/self-care.service.js'
import type { TaskReadContext } from '../tasks/task.model.js'
import type { TaskService } from '../tasks/task.service.js'

export interface PlannerSearchServices {
  taskService: TaskService
  chaosInboxService?: ChaosInboxService | undefined
  cleaningService?: CleaningService | undefined
  selfCareService?: SelfCareService | undefined
}

interface SearchPage {
  items: PlannerSearchItem[]
  hasMore: boolean
}

export async function searchPlanner(
  services: PlannerSearchServices,
  context: TaskReadContext,
  input: PlannerSearchQuery,
): Promise<PlannerSearchResponse> {
  const offset = (input.page - 1) * input.limit
  const matches = (title: string, description: string) =>
    `${title} ${description}`.toLowerCase().includes(input.query.toLowerCase())
  const slice = (items: PlannerSearchItem[]): SearchPage => ({
    items: items.slice(offset, offset + input.limit),
    hasMore: items.length > offset + input.limit,
  })
  const loaders: Array<{
    source: PlannerSearchSource
    load: () => Promise<SearchPage>
  }> = [
    {
      source: 'tasks',
      async load() {
        const page = await services.taskService.listTaskPage(context, {
          search: input.query,
          includeClosed: input.includeCompleted,
          offset,
          limit: input.limit,
        })
        return {
          hasMore: page.hasMore,
          items: page.items.map((task) => ({
            id: task.id,
            source: 'tasks',
            title: task.title,
            description: task.note,
            context: task.project,
            date: task.plannedDate ?? task.dueDate,
            status:
              task.status === 'done'
                ? 'done'
                : task.status === 'archived'
                  ? 'archived'
                  : 'active',
          })),
        }
      },
    },
    {
      source: 'shopping',
      async load() {
        if (!services.chaosInboxService) throw new Error('Shopping unavailable')
        const page = await services.chaosInboxService.listItems(context, {
          kind: 'shopping',
          search: input.query,
          includeCompleted: input.includeCompleted,
          page: input.page,
          limit: input.limit,
        })
        return {
          hasMore: page.total > offset + page.items.length,
          items: page.items.map((item) => ({
            id: item.id,
            source: 'shopping',
            title: item.text,
            description: '',
            context: {
              groceries: 'Продукты',
              household: 'Бытовое',
              other: 'Прочее',
            }[item.shoppingCategory ?? 'other'],
            date: item.dueDate,
            status: item.status === 'archived' ? 'done' : 'active',
          })),
        }
      },
    },
    {
      source: 'cleaning',
      async load() {
        if (!services.cleaningService) throw new Error('Cleaning unavailable')
        const data = await services.cleaningService.listCleaning(context)
        return slice(
          data.tasks
            .filter(
              (task) =>
                (input.includeCompleted || task.isActive) &&
                matches(task.title, task.description),
            )
            .sort(
              (a, b) =>
                a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
            )
            .map((task) => ({
              id: task.id,
              source: 'cleaning',
              title: task.title,
              description: task.description,
              context:
                data.zones.find((zone) => zone.id === task.zoneId)?.title ??
                'Общая уборка',
              date:
                data.states.find((state) => state.taskId === task.id)
                  ?.nextDueAt ?? null,
              status: task.isActive ? 'active' : 'archived',
            })),
        )
      },
    },
  ]
  // Self-care follows its existing personal-workspace access boundary.
  if (context.workspaceKind !== 'shared')
    loaders.push({
      source: 'care',
      async load() {
        if (!services.selfCareService) throw new Error('Self-care unavailable')
        const data = await services.selfCareService.listItems(context, {
          includeArchived: input.includeCompleted,
        })
        return slice(
          data.items
            .filter((item) => matches(item.title, item.description))
            .sort(
              (a, b) =>
                a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
            )
            .map((item) => ({
              id: item.id,
              source: 'care',
              title: item.title,
              description: item.description,
              context: 'Забота о себе',
              date: null,
              status: item.isArchived ? 'archived' : 'active',
            })),
        )
      },
    })
  const selected = loaders.filter(
    (loader) => input.source === 'all' || input.source === loader.source,
  )
  const results = await Promise.allSettled(
    selected.map((loader) => loader.load()),
  )
  const response: PlannerSearchResponse = {
    items: [],
    hasMore: false,
    page: input.page,
    unavailableSources: [],
  }
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      response.items.push(...result.value.items)
      response.hasMore ||= result.value.hasMore
    } else {
      // Never turn expired authentication or denied access into an empty result.
      if (
        result.reason instanceof HttpError &&
        [401, 403].includes(result.reason.statusCode)
      )
        throw result.reason
      const loader = selected[index]
      if (loader) response.unavailableSources.push(loader.source)
    }
  }
  return response
}
