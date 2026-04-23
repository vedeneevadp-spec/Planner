import type { NewTaskInput } from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { TaskService } from '../tasks/index.js'
import type {
  BulkDeleteChaosInboxItemsCommand,
  BulkUpdateChaosInboxItemsCommand,
  ChaosInboxReadContext,
  ChaosInboxWriteContext,
  CreateChaosInboxItemsCommand,
  ListChaosInboxItemsCommand,
  UpdateChaosInboxItemCommand,
} from './chaos-inbox.model.js'
import type { ChaosInboxRepository } from './chaos-inbox.repository.js'

export class ChaosInboxService {
  constructor(
    private readonly repository: ChaosInboxRepository,
    private readonly taskService: TaskService,
  ) {}

  listItems(
    context: ChaosInboxReadContext,
    filters?: ListChaosInboxItemsCommand['filters'],
  ) {
    return this.repository.list({ context, filters })
  }

  createItems(
    context: ChaosInboxWriteContext,
    input: CreateChaosInboxItemsCommand['input'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.create({ context, input })
  }

  updateItem(
    context: ChaosInboxWriteContext,
    id: string,
    input: UpdateChaosInboxItemCommand['input'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.update({ context, id, input })
  }

  bulkUpdate(
    context: ChaosInboxWriteContext,
    input: BulkUpdateChaosInboxItemsCommand['input'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.bulkUpdate({ context, input })
  }

  removeItem(context: ChaosInboxWriteContext, id: string) {
    assertCanWriteChaosInbox(context)

    return this.repository.remove({ context, id })
  }

  bulkRemove(
    context: ChaosInboxWriteContext,
    ids: BulkDeleteChaosInboxItemsCommand['ids'],
  ) {
    assertCanWriteChaosInbox(context)

    return this.repository.bulkRemove({ context, ids })
  }

  async convertToTask(context: ChaosInboxWriteContext, id: string) {
    assertCanWriteChaosInbox(context)

    const item = await this.repository.getById(context, id)

    if (item.convertedTaskId) {
      throw new HttpError(
        409,
        'chaos_inbox_already_converted',
        'Chaos inbox item has already been converted to a task.',
      )
    }

    const task = await this.taskService.createTask(context, buildTaskInput(item))
    const inboxItem = await this.repository.markConverted({
      context,
      convertedTaskId: task.id,
      id,
    })

    return {
      inboxItem,
      taskId: task.id,
    }
  }

  async bulkConvertToTasks(context: ChaosInboxWriteContext, ids: string[]) {
    assertCanWriteChaosInbox(context)

    const converted = []

    for (const id of ids) {
      converted.push(await this.convertToTask(context, id))
    }

    return converted
  }
}

function buildTaskInput(item: Awaited<ReturnType<ChaosInboxRepository['getById']>>): NewTaskInput {
  return {
    dueDate: item.dueDate,
    icon: '',
    importance: item.priority === 'high' ? 'important' : 'not_important',
    note: '',
    plannedDate: item.dueDate,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: item.sphereId,
    resource: item.priority === 'high' ? 3 : item.priority === 'low' ? 1 : 2,
    sphereId: item.sphereId,
    title: item.text,
    urgency: item.priority === 'high' ? 'urgent' : 'not_urgent',
  }
}

function assertCanWriteChaosInbox(context: ChaosInboxWriteContext): void {
  if (context.role === 'viewer') {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace role cannot write chaos inbox.',
    )
  }
}
