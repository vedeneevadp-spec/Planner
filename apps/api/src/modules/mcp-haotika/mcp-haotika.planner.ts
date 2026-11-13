import {
  type ChaosInboxItemRecord,
  createChaosInboxItemsInputSchema,
  getPlannerTimeZone,
  newTaskInputSchema,
  taskDetailsUpdateInputSchema,
  type TaskRecord,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { ChaosInboxService } from '../chaos-inbox/index.js'
import type { SessionService } from '../session/index.js'
import type { TaskService } from '../tasks/index.js'
import type { TaskWriteContext } from '../tasks/task.model.js'
import {
  plannerToolInputSchemas,
  type PlannerToolName,
} from './mcp-haotika.planner-schemas.js'

export class McpPlannerService {
  constructor(
    private readonly dependencies: {
      sessionService: SessionService
      taskService: TaskService
      shoppingService?: ChaosInboxService | undefined
    },
  ) {}

  async execute(
    name: PlannerToolName,
    input: unknown,
    userId: string,
  ): Promise<unknown> {
    const context = await this.resolveContext(userId)
    const tasks = this.dependencies.taskService
    switch (name) {
      case 'list_tasks': {
        const filters = parseOrThrow(
          plannerToolInputSchemas.list_tasks,
          input,
          'invalid_input',
        )
        const result = await tasks.listTaskPage(context, filters)
        return {
          ...result,
          items: result.items.map((task) => taskView(task, false)),
        }
      }
      case 'get_task': {
        const { id } = parseOrThrow(
          plannerToolInputSchemas.get_task,
          input,
          'invalid_input',
        )
        return { task: taskView(await tasks.getTask(context, id)) }
      }
      case 'create_task': {
        const fields = parseOrThrow(
          plannerToolInputSchemas.create_task,
          input,
          'invalid_input',
        )
        const task = await tasks.createTask(
          context,
          newTaskInputSchema.parse(fields),
        )
        if (
          Object.entries(fields).some(
            ([key, value]) =>
              value !== undefined && task[key as keyof TaskRecord] !== value,
          )
        ) {
          throw new HttpError(
            409,
            'task_creation_conflict',
            'This creation ID already belongs to a task with different fields. Read the task before deciding what to do next.',
          )
        }
        return { task: taskView(task) }
      }
      case 'update_task': {
        const { id, ...patch } = parseOrThrow(
          plannerToolInputSchemas.update_task,
          input,
          'invalid_input',
        )
        const current = await tasks.getTask(context, id)
        const fields = taskDetailsUpdateInputSchema.parse({
          ...current,
          ...patch,
          ...(patch.plannedDate === null
            ? {
                plannedStartTime: null,
                plannedEndTime: null,
                remindBeforeStart: false,
                reminderOffsets: [],
              }
            : {}),
        })
        const updated = await tasks.updateTask(
          {
            ...context,
            clientTimeZone:
              current.schedule?.kind === 'fixed_zone_datetime'
                ? current.schedule.timeZone
                : context.clientTimeZone,
          },
          id,
          fields,
        )
        return { task: taskView(updated) }
      }
      case 'complete_task': {
        const { id, expectedVersion } = parseOrThrow(
          plannerToolInputSchemas.complete_task,
          input,
          'invalid_input',
        )
        return {
          task: taskView(
            await tasks.setTaskStatus(context, id, 'done', expectedVersion),
          ),
        }
      }
      case 'list_shopping': {
        const filters = parseOrThrow(
          plannerToolInputSchemas.list_shopping,
          input,
          'invalid_input',
        )
        const result = await this.shopping.listItems(context, {
          ...filters,
          kind: 'shopping',
        })
        return {
          ...result,
          items: result.items.map((item) => shoppingView(item, false)),
        }
      }
      case 'get_shopping_item': {
        const { id } = parseOrThrow(
          plannerToolInputSchemas.get_shopping_item,
          input,
          'invalid_input',
        )
        return {
          item: shoppingView(await this.shopping.getShoppingItem(context, id)),
        }
      }
      case 'create_shopping_item': {
        const fields = parseOrThrow(
          plannerToolInputSchemas.create_shopping_item,
          input,
          'invalid_input',
        )
        const items = await this.shopping.createItems(
          context,
          createChaosInboxItemsInputSchema.parse({
            items: [{ ...fields, kind: 'shopping' }],
          }),
        )
        const item = items[0]
        if (!item) throw new Error('Shopping creation returned no item.')
        return { item: shoppingView(item) }
      }
      case 'update_shopping_item': {
        const { id, ...patch } = parseOrThrow(
          plannerToolInputSchemas.update_shopping_item,
          input,
          'invalid_input',
        )
        return {
          item: shoppingView(
            await this.shopping.updateShoppingItem(context, id, patch),
          ),
        }
      }
      case 'complete_shopping_item': {
        const { id } = parseOrThrow(
          plannerToolInputSchemas.complete_shopping_item,
          input,
          'invalid_input',
        )
        const current = await this.shopping.getShoppingItem(context, id)
        const item =
          current.status === 'archived'
            ? current
            : await this.shopping.updateShoppingItem(context, id, {
                status: 'archived',
              })
        return { item: shoppingView(item) }
      }
    }
  }

  private get shopping(): ChaosInboxService {
    if (!this.dependencies.shoppingService) {
      throw new HttpError(
        503,
        'shopping_unavailable',
        'Shopping is unavailable.',
      )
    }
    return this.dependencies.shoppingService
  }

  private async resolveContext(userId: string): Promise<TaskWriteContext> {
    // The subject comes only from the verified MCP OAuth token, never tool arguments.
    const auth: AuthenticatedRequestContext = {
      accessToken: 'mcp-planner',
      claims: {
        sub: userId,
        role: 'authenticated',
        payload: { sub: userId, role: 'authenticated' },
      },
    }
    const base = await this.dependencies.sessionService.resolveSession({
      auth,
      actorUserId: undefined,
      workspaceId: undefined,
    })
    const workspaceId =
      base.workspaces.find((workspace) => workspace.kind === 'personal')?.id ??
      (base.workspace.kind === 'personal' ? base.workspaceId : undefined)
    if (!workspaceId)
      throw new HttpError(
        403,
        'personal_workspace_not_found',
        'Personal workspace was not found.',
      )
    const authenticated = {
      ...auth,
      claims: {
        ...auth.claims,
        email: base.actor.email,
        payload: { ...auth.claims.payload, email: base.actor.email },
      },
    }
    const session =
      workspaceId === base.workspaceId
        ? base
        : await this.dependencies.sessionService.resolveSession({
            auth: authenticated,
            actorUserId: undefined,
            workspaceId,
          })
    if (
      session.actorUserId !== userId ||
      session.workspaceId !== workspaceId ||
      session.workspace.kind !== 'personal'
    ) {
      throw new HttpError(
        403,
        'workspace_access_denied',
        'Personal workspace access denied.',
      )
    }
    return {
      auth: authenticated,
      actorUserId: userId,
      actorDisplayName: session.actor.displayName,
      workspaceId,
      workspaceKind: session.workspace.kind,
      role: session.role,
      groupRole: session.groupRole,
      clientTimeZone: getPlannerTimeZone({
        deviceTimeZone: session.userPreferences.lastSeenTimeZone,
        timeZoneMode: session.userPreferences.timeZoneMode,
        userTimeZone: session.userPreferences.defaultTimeZone,
        workspaceTimeZone: session.workspaceSettings.defaultTimeZone,
      }),
    }
  }
}

function taskView(task: TaskRecord, details = true) {
  return {
    id: task.id,
    version: task.version,
    title: task.title,
    status: task.status,
    plannedDate: task.plannedDate,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    importance: task.importance,
    necessity: task.necessity,
    resource: task.resource,
    project: task.project,
    ...(details
      ? {
          note: task.note,
          plannedStartTime: task.plannedStartTime,
          plannedEndTime: task.plannedEndTime,
          schedule: task.schedule,
          recurrence: task.recurrence,
          reminderOffsets: task.reminderOffsets,
        }
      : {}),
  }
}

function shoppingView(item: ChaosInboxItemRecord, details = true) {
  return {
    id: item.id,
    version: item.version,
    text: details ? item.text : item.text.slice(0, 500),
    ...(details ? {} : { textTruncated: item.text.length > 500 }),
    status: item.status,
    priority: item.priority,
    dueDate: item.dueDate,
    isFavorite: item.isFavorite,
    shoppingCategory: item.shoppingCategory,
    productUrl: item.productUrl,
    completedAt: item.completedAt,
  }
}
