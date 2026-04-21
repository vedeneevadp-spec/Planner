import type {
  CreateTaskTemplateCommand,
  DeleteTaskTemplateCommand,
  StoredTaskTemplateRecord,
  TaskTemplateReadContext,
} from './task-template.model.js'

export interface TaskTemplateRepository {
  listByWorkspace(
    context: TaskTemplateReadContext,
  ): Promise<StoredTaskTemplateRecord[]>
  create(command: CreateTaskTemplateCommand): Promise<StoredTaskTemplateRecord>
  remove(command: DeleteTaskTemplateCommand): Promise<void>
}
