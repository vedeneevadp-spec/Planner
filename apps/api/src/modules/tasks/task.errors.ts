import { HttpError } from '../../bootstrap/http-error.js'

export class TaskNotFoundError extends HttpError {
  constructor(taskId: string) {
    super(404, 'task_not_found', `Task "${taskId}" was not found.`)
  }
}

export class TaskVersionConflictError extends HttpError {
  constructor(taskId: string, expectedVersion: number, actualVersion: number) {
    super(409, 'task_version_conflict', `Task "${taskId}" version conflict.`, {
      actualVersion,
      expectedVersion,
    })
  }
}
