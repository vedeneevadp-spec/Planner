import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CreateTaskTemplateCommand,
  DeleteTaskTemplateCommand,
  TaskTemplateReadContext,
  TaskTemplateWriteContext,
} from './task-template.model.js'
import type { TaskTemplateRepository } from './task-template.repository.js'

export class TaskTemplateService {
  constructor(private readonly repository: TaskTemplateRepository) {}

  listTaskTemplates(context: TaskTemplateReadContext) {
    return this.repository.listByWorkspace(context)
  }

  createTaskTemplate(
    context: TaskTemplateWriteContext,
    input: CreateTaskTemplateCommand['input'],
  ) {
    assertCanWriteTaskTemplates(context)

    return this.repository.create({ context, input })
  }

  removeTaskTemplate(context: TaskTemplateWriteContext, templateId: string) {
    assertCanWriteTaskTemplates(context)

    const command: DeleteTaskTemplateCommand = {
      context,
      templateId,
    }

    return this.repository.remove(command)
  }
}

function assertCanWriteTaskTemplates(context: TaskTemplateWriteContext): void {
  if (context.role === 'viewer') {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace role cannot write task templates.',
    )
  }
}
