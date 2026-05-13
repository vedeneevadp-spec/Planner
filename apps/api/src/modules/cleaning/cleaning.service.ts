import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type {
  CleaningReadContext,
  CleaningWriteContext,
} from './cleaning.model.js'
import type { CleaningRepository } from './cleaning.repository.js'

export class CleaningService {
  constructor(private readonly repository: CleaningRepository) {}

  listCleaning(context: CleaningReadContext) {
    return this.repository.listByWorkspace(context)
  }

  getToday(context: CleaningReadContext, date: string) {
    return this.repository.getToday({ context, date })
  }

  createZone(
    context: CleaningWriteContext,
    input: Parameters<CleaningRepository['createZone']>[0]['input'],
  ) {
    assertCanWriteCleaning(context)

    return this.repository.createZone({ context, input })
  }

  updateZone(
    context: CleaningWriteContext,
    zoneId: string,
    input: Parameters<CleaningRepository['updateZone']>[0]['input'],
  ) {
    assertCanWriteCleaning(context)

    return this.repository.updateZone({ context, input, zoneId })
  }

  removeZone(context: CleaningWriteContext, zoneId: string) {
    assertCanWriteCleaning(context)

    return this.repository.removeZone({ context, zoneId })
  }

  createTask(
    context: CleaningWriteContext,
    input: Parameters<CleaningRepository['createTask']>[0]['input'],
  ) {
    assertCanWriteCleaning(context)

    return this.repository.createTask({ context, input })
  }

  updateTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['updateTask']>[0]['input'],
  ) {
    assertCanWriteCleaning(context)

    return this.repository.updateTask({ context, input, taskId })
  }

  removeTask(context: CleaningWriteContext, taskId: string) {
    assertCanWriteCleaning(context)

    return this.repository.removeTask({ context, taskId })
  }

  completeTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['recordTaskAction']>[0]['input'],
  ) {
    assertCanWriteCleaning(context)

    return this.repository.recordTaskAction({
      action: 'completed',
      context,
      input,
      taskId,
    })
  }

  postponeTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['recordTaskAction']>[0]['input'],
  ) {
    assertCanWriteCleaning(context)

    return this.repository.recordTaskAction({
      action: 'postponed',
      context,
      input,
      taskId,
    })
  }

  skipTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['recordTaskAction']>[0]['input'],
  ) {
    assertCanWriteCleaning(context)

    return this.repository.recordTaskAction({
      action: 'skipped',
      context,
      input,
      taskId,
    })
  }
}

function assertCanWriteCleaning(context: CleaningWriteContext): void {
  if (!canWriteWorkspaceContent(context)) {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace access cannot write cleaning data.',
    )
  }
}
