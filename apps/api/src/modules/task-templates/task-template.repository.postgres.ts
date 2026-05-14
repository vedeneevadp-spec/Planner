import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type {
  DatabaseSchema,
  JsonObject,
} from '../../infrastructure/db/schema.js'
import { LifeSphereNotFoundError } from '../life-spheres/life-sphere.errors.js'
import { TaskTemplateNotFoundError } from './task-template.errors.js'
import type {
  CreateTaskTemplateCommand,
  DeleteTaskTemplateCommand,
  StoredTaskTemplateRecord,
  TaskTemplateReadContext,
} from './task-template.model.js'
import type { TaskTemplateRepository } from './task-template.repository.js'
import {
  normalizeTaskTemplateInput,
  normalizeTaskTemplateSchedule,
  sortStoredTaskTemplates,
} from './task-template.shared.js'

type TaskTemplateRow = Selectable<DatabaseSchema['app.task_templates']>
type ProjectRow = Selectable<DatabaseSchema['app.projects']>
type TaskTemplateListRow = TaskTemplateRow & {
  project_title?: ProjectRow['title'] | null
}

interface ResolvedTaskTemplateProject {
  id: string
  title: string
}

const LEGACY_PROJECT_NAME_KEY = 'legacyProjectName'
const TASK_ICON_KEY = 'taskIcon'
const TASK_IMPORTANCE_KEY = 'taskImportance'
const TASK_URGENCY_KEY = 'taskUrgency'
const DEFAULT_TASK_IMPORTANCE = 'not_important'
const DEFAULT_TASK_URGENCY = 'not_urgent'

export class PostgresTaskTemplateRepository implements TaskTemplateRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(
    context: TaskTemplateReadContext,
  ): Promise<StoredTaskTemplateRecord[]> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) => this.loadTemplateRows(executor, context.workspaceId),
      context.actorUserId,
    )

    return sortStoredTaskTemplates(
      rows.map((row) => this.mapTaskTemplateRecord(row)),
    )
  }

  async create(
    command: CreateTaskTemplateCommand,
  ): Promise<StoredTaskTemplateRecord> {
    const normalizedInput = normalizeTaskTemplateInput(command.input)
    const normalizedSchedule = normalizeTaskTemplateSchedule(command.input)
    const project = await this.resolveTaskTemplateProject(
      command.context,
      normalizedInput.projectId,
    )
    const templateId = normalizedInput.id ?? generateUuidV7()
    const metadata = this.buildTemplateMetadata(
      project ? '' : normalizedInput.project,
      normalizedInput,
    )

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const insertedTemplate = await trx
          .insertInto('app.task_templates')
          .values({
            created_by: command.context.actorUserId,
            deleted_at: null,
            description: normalizedInput.note,
            due_on: normalizedInput.dueDate,
            id: templateId,
            metadata,
            planned_end_time: normalizedSchedule.plannedEndTime,
            planned_on: normalizedSchedule.plannedDate,
            planned_start_time: normalizedSchedule.plannedStartTime,
            project_id: project?.id ?? null,
            title: normalizedInput.title,
            updated_by: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()

        const template = insertedTemplate
          ? insertedTemplate
          : await this.loadActiveTemplate(
              trx,
              command.context.workspaceId,
              templateId,
            )

        if (!template) {
          throw new Error('Failed to create task template record.')
        }

        const projectTitle = await this.loadProjectTitle(
          trx,
          command.context.workspaceId,
          template.project_id,
        )

        return this.mapTaskTemplateRecord({
          ...template,
          project_title: projectTitle,
        })
      },
      command.context.actorUserId,
    )
  }

  async remove(command: DeleteTaskTemplateCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const deletedTemplate = await trx
          .updateTable('app.task_templates')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.templateId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .returning(['id'])
          .executeTakeFirst()

        if (!deletedTemplate) {
          throw new TaskTemplateNotFoundError(command.templateId)
        }
      },
      command.context.actorUserId,
    )
  }

  private loadTemplateRows(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<TaskTemplateListRow[]> {
    return executor
      .selectFrom('app.task_templates as template')
      .leftJoin('app.projects as project', (join) =>
        join
          .onRef('project.id', '=', 'template.project_id')
          .onRef('project.workspace_id', '=', 'template.workspace_id')
          .on('project.deleted_at', 'is', null),
      )
      .selectAll('template')
      .select('project.title as project_title')
      .where('template.workspace_id', '=', workspaceId)
      .where('template.deleted_at', 'is', null)
      .orderBy('template.title', 'asc')
      .orderBy('template.created_at', 'asc')
      .execute()
  }

  private loadActiveTemplate(
    executor: DatabaseExecutor,
    workspaceId: string,
    templateId: string,
  ): Promise<TaskTemplateRow | undefined> {
    return executor
      .selectFrom('app.task_templates')
      .selectAll()
      .where('id', '=', templateId)
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private async resolveTaskTemplateProject(
    context: CreateTaskTemplateCommand['context'],
    projectId: string | null,
  ): Promise<ResolvedTaskTemplateProject | null> {
    if (!projectId) {
      return null
    }

    const project = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        executor
          .selectFrom('app.projects')
          .select(['id', 'title'])
          .where('id', '=', projectId)
          .where('workspace_id', '=', context.workspaceId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'active')
          .executeTakeFirst(),
      context.actorUserId,
    )

    if (!project) {
      throw new LifeSphereNotFoundError(projectId)
    }

    return {
      id: project.id,
      title: project.title,
    }
  }

  private loadProjectTitle(
    executor: DatabaseExecutor,
    workspaceId: string,
    projectId: string | null,
  ): Promise<string | null> {
    if (!projectId) {
      return Promise.resolve(null)
    }

    return executor
      .selectFrom('app.projects')
      .select('title')
      .where('id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
      .then((project) => project?.title ?? null)
  }

  private buildTemplateMetadata(
    projectName: string,
    input: Pick<StoredTaskTemplateRecord, 'icon' | 'importance' | 'urgency'>,
  ): JsonObject {
    const metadata: JsonObject = {}

    if (projectName) {
      metadata[LEGACY_PROJECT_NAME_KEY] = projectName
    }

    if (input.icon) {
      metadata[TASK_ICON_KEY] = input.icon
    }

    if (input.importance !== DEFAULT_TASK_IMPORTANCE) {
      metadata[TASK_IMPORTANCE_KEY] = input.importance
    }

    if (input.urgency !== DEFAULT_TASK_URGENCY) {
      metadata[TASK_URGENCY_KEY] = input.urgency
    }

    return metadata
  }

  private mapTaskTemplateRecord(
    template: TaskTemplateListRow,
  ): StoredTaskTemplateRecord {
    return {
      createdAt: serializeTimestamp(template.created_at),
      deletedAt: serializeNullableTimestamp(template.deleted_at),
      dueDate: serializeNullableDate(template.due_on),
      id: template.id,
      icon: this.readTaskIcon(template.metadata),
      importance: this.readTaskImportance(template.metadata),
      note: template.description,
      plannedDate: serializeNullableDate(template.planned_on),
      plannedEndTime: serializeNullableTime(template.planned_end_time),
      plannedStartTime: serializeNullableTime(template.planned_start_time),
      project: this.resolveProjectName(template),
      projectId: template.project_id,
      title: template.title,
      urgency: this.readTaskUrgency(template.metadata),
      updatedAt: serializeTimestamp(template.updated_at),
      version: Number(template.version),
      workspaceId: template.workspace_id,
    }
  }

  private resolveProjectName(template: TaskTemplateListRow): string {
    if (template.project_title) {
      return template.project_title
    }

    const legacyProjectName = template.metadata[LEGACY_PROJECT_NAME_KEY]

    return typeof legacyProjectName === 'string' ? legacyProjectName : ''
  }

  private readTaskIcon(metadata: JsonObject): string {
    const value = metadata[TASK_ICON_KEY]

    return typeof value === 'string' ? value : ''
  }

  private readTaskImportance(
    metadata: JsonObject,
  ): StoredTaskTemplateRecord['importance'] {
    const value = metadata[TASK_IMPORTANCE_KEY]

    return value === 'important' || value === 'not_important'
      ? value
      : DEFAULT_TASK_IMPORTANCE
  }

  private readTaskUrgency(
    metadata: JsonObject,
  ): StoredTaskTemplateRecord['urgency'] {
    const value = metadata[TASK_URGENCY_KEY]

    return value === 'urgent' || value === 'not_urgent'
      ? value
      : DEFAULT_TASK_URGENCY
  }
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    return value
  }

  throw new TypeError('Expected timestamp to be a string or Date.')
}

function serializeNullableDate(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'string') {
    return value
  }

  throw new TypeError('Expected date to be a string or Date.')
}

function serializeNullableTime(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString().slice(11, 16)
  }

  if (typeof value === 'string') {
    return value.slice(0, 5)
  }

  throw new TypeError('Expected time to be a string or Date.')
}
