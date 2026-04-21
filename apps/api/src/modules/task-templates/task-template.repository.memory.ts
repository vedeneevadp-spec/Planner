import { TaskTemplateNotFoundError } from './task-template.errors.js'
import type {
  CreateTaskTemplateCommand,
  DeleteTaskTemplateCommand,
  StoredTaskTemplateRecord,
  TaskTemplateReadContext,
} from './task-template.model.js'
import type { TaskTemplateRepository } from './task-template.repository.js'
import {
  createStoredTaskTemplateRecord,
  markTaskTemplateDeleted,
  sortStoredTaskTemplates,
} from './task-template.shared.js'

export class MemoryTaskTemplateRepository implements TaskTemplateRepository {
  private readonly templates = new Map<string, StoredTaskTemplateRecord>()

  listByWorkspace(
    context: TaskTemplateReadContext,
  ): Promise<StoredTaskTemplateRecord[]> {
    const templates = [...this.templates.values()].filter(
      (template) =>
        template.workspaceId === context.workspaceId &&
        template.deletedAt === null,
    )

    return Promise.resolve(sortStoredTaskTemplates(templates))
  }

  create(
    command: CreateTaskTemplateCommand,
  ): Promise<StoredTaskTemplateRecord> {
    const existingTemplate = command.input.id
      ? this.templates.get(command.input.id)
      : undefined

    if (
      existingTemplate &&
      existingTemplate.workspaceId === command.context.workspaceId &&
      existingTemplate.deletedAt === null
    ) {
      return Promise.resolve(existingTemplate)
    }

    const template = createStoredTaskTemplateRecord(command.input, {
      workspaceId: command.context.workspaceId,
    })

    this.templates.set(template.id, template)

    return Promise.resolve(template)
  }

  remove(command: DeleteTaskTemplateCommand): Promise<void> {
    const template = this.getTemplateOrThrow(
      command.templateId,
      command.context.workspaceId,
    )
    const deletedTemplate = markTaskTemplateDeleted(template)

    this.templates.set(template.id, deletedTemplate)

    return Promise.resolve()
  }

  private getTemplateOrThrow(
    templateId: string,
    workspaceId: string,
  ): StoredTaskTemplateRecord {
    const template = this.templates.get(templateId)

    if (
      !template ||
      template.workspaceId !== workspaceId ||
      template.deletedAt !== null
    ) {
      throw new TaskTemplateNotFoundError(templateId)
    }

    return template
  }
}
