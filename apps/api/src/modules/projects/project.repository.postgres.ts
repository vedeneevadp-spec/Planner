import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import {
  ProjectNotFoundError,
  ProjectVersionConflictError,
} from './project.errors.js'
import type {
  CreateProjectCommand,
  ProjectReadContext,
  StoredProjectRecord,
  UpdateProjectCommand,
} from './project.model.js'
import type { ProjectRepository } from './project.repository.js'
import {
  buildProjectSlug,
  normalizeProjectInput,
  normalizeProjectUpdateInput,
  sortStoredProjects,
} from './project.shared.js'

type ProjectRow = Selectable<DatabaseSchema['app.projects']>

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(
    context: ProjectReadContext,
  ): Promise<StoredProjectRecord[]> {
    const projectRows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        executor
          .selectFrom('app.projects')
          .selectAll()
          .where('workspace_id', '=', context.workspaceId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'active')
          .orderBy('position', 'asc')
          .orderBy('created_at', 'asc')
          .execute(),
      context.actorUserId,
    )

    return sortStoredProjects(
      projectRows.map((projectRow) => this.mapProjectRecord(projectRow)),
    )
  }

  async getById(
    context: ProjectReadContext,
    projectId: string,
  ): Promise<StoredProjectRecord> {
    const projectRow = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        this.loadActiveProject(executor, context.workspaceId, projectId),
      context.actorUserId,
    )

    if (!projectRow) {
      throw new ProjectNotFoundError(projectId)
    }

    return this.mapProjectRecord(projectRow)
  }

  async create(command: CreateProjectCommand): Promise<StoredProjectRecord> {
    const normalizedInput = normalizeProjectInput(command.input)
    const projectId = normalizedInput.id ?? generateUuidV7()
    const slug = buildProjectSlug(normalizedInput.title, projectId)

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const nextPosition = await this.loadNextPosition(
          trx,
          command.context.workspaceId,
        )
        const insertedProject = await trx
          .insertInto('app.projects')
          .values({
            color: normalizedInput.color,
            created_by: command.context.actorUserId,
            deleted_at: null,
            description: normalizedInput.description,
            icon: normalizedInput.icon,
            id: projectId,
            metadata: {},
            position: nextPosition,
            slug,
            status: 'active',
            title: normalizedInput.title,
            updated_by: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()

        const project = insertedProject
          ? insertedProject
          : await this.loadActiveProject(
              trx,
              command.context.workspaceId,
              projectId,
            )

        if (!project) {
          throw new Error('Failed to create project record.')
        }

        return this.mapProjectRecord(project)
      },
      command.context.actorUserId,
    )
  }

  async update(command: UpdateProjectCommand): Promise<StoredProjectRecord> {
    const normalizedInput = normalizeProjectUpdateInput(command.input)

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.projects')
          .set({
            ...(normalizedInput.title !== undefined
              ? { title: normalizedInput.title }
              : {}),
            ...(normalizedInput.description !== undefined
              ? { description: normalizedInput.description }
              : {}),
            ...(normalizedInput.color !== undefined
              ? { color: normalizedInput.color }
              : {}),
            ...(normalizedInput.icon !== undefined
              ? { icon: normalizedInput.icon }
              : {}),
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.projectId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'active')

        if (normalizedInput.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            normalizedInput.expectedVersion,
          )
        }

        const updatedProject = await updateQuery
          .returningAll()
          .executeTakeFirst()

        if (!updatedProject) {
          const currentProject = await this.loadCurrentProjectVersion(
            trx,
            command.context.workspaceId,
            command.projectId,
          )

          if (!currentProject) {
            throw new ProjectNotFoundError(command.projectId)
          }

          if (
            normalizedInput.expectedVersion !== undefined &&
            Number(currentProject.version) !== normalizedInput.expectedVersion
          ) {
            throw new ProjectVersionConflictError(
              command.projectId,
              normalizedInput.expectedVersion,
              Number(currentProject.version),
            )
          }

          throw new Error(`Project "${command.projectId}" was not updated.`)
        }

        return this.mapProjectRecord(updatedProject)
      },
      command.context.actorUserId,
    )
  }

  private loadActiveProject(
    executor: DatabaseExecutor,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectRow | undefined> {
    return executor
      .selectFrom('app.projects')
      .selectAll()
      .where('id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'active')
      .executeTakeFirst()
  }

  private async loadNextPosition(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<number> {
    const result = await executor
      .selectFrom('app.projects')
      .select(({ fn }) => fn.max<number>('position').as('max_position'))
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst()

    return Number(result?.max_position ?? -1) + 1
  }

  private loadCurrentProjectVersion(
    executor: DatabaseExecutor,
    workspaceId: string,
    projectId: string,
  ): Promise<Pick<ProjectRow, 'id' | 'version'> | undefined> {
    return executor
      .selectFrom('app.projects')
      .select(['id', 'version'])
      .where('id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'active')
      .executeTakeFirst()
  }

  private mapProjectRecord(project: ProjectRow): StoredProjectRecord {
    return {
      color: project.color ?? '#2f6f62',
      createdAt: serializeTimestamp(project.created_at),
      deletedAt: serializeNullableTimestamp(project.deleted_at),
      description: project.description,
      icon: project.icon,
      id: project.id,
      status: project.status,
      title: project.title,
      updatedAt: serializeTimestamp(project.updated_at),
      version: Number(project.version),
      workspaceId: project.workspace_id,
    }
  }
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
