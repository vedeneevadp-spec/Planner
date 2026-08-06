import { createHash } from 'node:crypto'

import type { CleaningSeedInput } from '@planner/contracts'

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
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.createZone({
      context,
      input,
      operation: createCleaningOperation(operationId, 'zone.create', input),
    })
  }

  updateZone(
    context: CleaningWriteContext,
    zoneId: string,
    input: Parameters<CleaningRepository['updateZone']>[0]['input'],
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.updateZone({
      context,
      input,
      operation: createCleaningOperation(operationId, 'zone.update', {
        input,
        zoneId,
      }),
      zoneId,
    })
  }

  removeZone(
    context: CleaningWriteContext,
    zoneId: string,
    expectedVersion?: number,
    expectedTaskVersions?: Array<{ taskId: string; version: number }>,
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.removeZone({
      context,
      expectedTaskVersions,
      expectedVersion,
      operation: createCleaningOperation(operationId, 'zone.delete', {
        expectedTaskVersions,
        expectedVersion,
        zoneId,
      }),
      zoneId,
    })
  }

  createTask(
    context: CleaningWriteContext,
    input: Parameters<CleaningRepository['createTask']>[0]['input'],
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.createTask({
      context,
      input,
      operation: createCleaningOperation(operationId, 'task.create', input),
    })
  }

  updateTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['updateTask']>[0]['input'],
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.updateTask({
      context,
      input,
      operation: createCleaningOperation(operationId, 'task.update', {
        input,
        taskId,
      }),
      taskId,
    })
  }

  removeTask(
    context: CleaningWriteContext,
    taskId: string,
    expectedVersion?: number,
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.removeTask({
      context,
      expectedVersion,
      operation: createCleaningOperation(operationId, 'task.delete', {
        expectedVersion,
        taskId,
      }),
      taskId,
    })
  }

  completeTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['recordTaskAction']>[0]['input'],
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.recordTaskAction({
      action: 'completed',
      context,
      input,
      operation: createCleaningOperation(operationId, 'task.complete', {
        input,
        taskId,
      }),
      taskId,
    })
  }

  postponeTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['recordTaskAction']>[0]['input'],
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.recordTaskAction({
      action: 'postponed',
      context,
      input,
      operation: createCleaningOperation(operationId, 'task.postpone', {
        input,
        taskId,
      }),
      taskId,
    })
  }

  skipTask(
    context: CleaningWriteContext,
    taskId: string,
    input: Parameters<CleaningRepository['recordTaskAction']>[0]['input'],
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.recordTaskAction({
      action: 'skipped',
      context,
      input,
      operation: createCleaningOperation(operationId, 'task.skip', {
        input,
        taskId,
      }),
      taskId,
    })
  }

  seed(
    context: CleaningWriteContext,
    input: CleaningSeedInput,
    operationId?: string,
  ) {
    assertCanWriteCleaning(context)

    return this.repository.seed({
      context,
      input,
      operation: createCleaningOperation(operationId, 'cleaning.seed', input),
    })
  }
}

function createCleaningOperation(
  operationId: string | undefined,
  type: string,
  input: unknown,
) {
  if (!operationId) {
    return undefined
  }

  return {
    fingerprint: createHash('sha256')
      .update(canonicalJson({ input, type }))
      .digest('hex'),
    id: operationId,
    type,
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
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
