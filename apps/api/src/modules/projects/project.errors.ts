import { HttpError } from '../../bootstrap/http-error.js'

export class ProjectNotFoundError extends HttpError {
  constructor(projectId: string) {
    super(404, 'project_not_found', `Project "${projectId}" was not found.`)
  }
}

export class ProjectVersionConflictError extends HttpError {
  constructor(
    projectId: string,
    expectedVersion: number,
    actualVersion: number,
  ) {
    super(
      409,
      'project_version_conflict',
      `Project "${projectId}" version conflict.`,
      {
        actualVersion,
        expectedVersion,
      },
    )
  }
}
