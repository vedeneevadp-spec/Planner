import { HttpError } from '../../bootstrap/http-error.js'

export class TaskTemplateNotFoundError extends HttpError {
  constructor(templateId: string) {
    super(
      404,
      'task_template_not_found',
      `Task template "${templateId}" was not found.`,
    )
  }
}
