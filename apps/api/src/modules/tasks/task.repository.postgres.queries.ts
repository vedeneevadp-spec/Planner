import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import { LifeSphereNotFoundError } from '../life-spheres/life-sphere.errors.js'
import type { CreateTaskCommand, TaskListFilters } from './task.model.js'
import {
  LEGACY_PROJECT_NAME_KEY,
  type ProjectRow,
  type ResolvedTaskAssignee,
  type ResolvedTaskProject,
  TASK_LIST_BATCH_SIZE,
  type TaskListRow,
  type TaskRow,
  type TaskRowsQuery,
  type TaskTimeBlockRow,
} from './task.repository.postgres.types.js'

export async function loadTaskRowsWithPrimaryTimeBlock(
  executor: DatabaseExecutor,
  workspaceId: string,
  filters?: TaskListFilters,
): Promise<TaskListRow[]> {
  const taskRows = await loadTaskRowsInBatches(executor, workspaceId, filters)

  if (taskRows.length === 0) {
    return []
  }

  const [
    primaryTimeBlocks,
    projectTitles,
    assigneeDisplayNames,
    authorDisplayNames,
  ] = await Promise.all([
    loadPrimaryTimeBlocksForTasks(executor, workspaceId, taskRows),
    loadProjectTitlesForTasks(executor, workspaceId, taskRows),
    loadAssigneeDisplayNamesForTasks(executor, taskRows),
    loadAuthorDisplayNamesForTasks(executor, taskRows),
  ])

  return taskRows.map((taskRow) => {
    const timeBlock = primaryTimeBlocks.get(taskRow.id)

    return {
      ...taskRow,
      assignee_display_name: taskRow.assignee_user_id
        ? (assigneeDisplayNames.get(taskRow.assignee_user_id) ?? null)
        : null,
      author_display_name: taskRow.created_by
        ? (authorDisplayNames.get(taskRow.created_by) ?? null)
        : null,
      project_title: taskRow.project_id
        ? (projectTitles.get(taskRow.project_id) ?? null)
        : null,
      time_block_ends_at: timeBlock?.ends_at ?? null,
      time_block_starts_at: timeBlock?.starts_at ?? null,
    }
  })
}

export async function loadTaskRowsPageWithPrimaryTimeBlock(
  executor: DatabaseExecutor,
  workspaceId: string,
  filters: TaskListFilters & { limit: number; offset: number },
): Promise<TaskListRow[]> {
  const taskRows = await loadTaskRowsPage(executor, workspaceId, filters)

  if (taskRows.length === 0) {
    return []
  }

  const [
    primaryTimeBlocks,
    projectTitles,
    assigneeDisplayNames,
    authorDisplayNames,
  ] = await Promise.all([
    loadPrimaryTimeBlocksForTasks(executor, workspaceId, taskRows),
    loadProjectTitlesForTasks(executor, workspaceId, taskRows),
    loadAssigneeDisplayNamesForTasks(executor, taskRows),
    loadAuthorDisplayNamesForTasks(executor, taskRows),
  ])

  return taskRows.map((taskRow) => {
    const timeBlock = primaryTimeBlocks.get(taskRow.id)

    return {
      ...taskRow,
      assignee_display_name: taskRow.assignee_user_id
        ? (assigneeDisplayNames.get(taskRow.assignee_user_id) ?? null)
        : null,
      author_display_name: taskRow.created_by
        ? (authorDisplayNames.get(taskRow.created_by) ?? null)
        : null,
      project_title: taskRow.project_id
        ? (projectTitles.get(taskRow.project_id) ?? null)
        : null,
      time_block_ends_at: timeBlock?.ends_at ?? null,
      time_block_starts_at: timeBlock?.starts_at ?? null,
    }
  })
}

export function loadTaskRowsPage(
  executor: DatabaseExecutor,
  workspaceId: string,
  filters: TaskListFilters & { limit: number; offset: number },
): Promise<TaskRow[]> {
  const query = applyTaskListFilters(
    executor
      .selectFrom('app.tasks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null),
    filters,
  )
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .limit(filters.limit)
    .offset(filters.offset)

  return query.execute()
}

export async function loadTaskRowsInBatches(
  executor: DatabaseExecutor,
  workspaceId: string,
  filters?: TaskListFilters,
): Promise<TaskRow[]> {
  const taskRows: TaskRow[] = []
  let offset = 0

  for (;;) {
    const query = applyTaskListFilters(
      executor
        .selectFrom('app.tasks')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('deleted_at', 'is', null),
      filters,
    )
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(TASK_LIST_BATCH_SIZE)
      .offset(offset)

    const batch = await query.execute()

    taskRows.push(...batch)

    if (batch.length < TASK_LIST_BATCH_SIZE) {
      return taskRows
    }

    offset += TASK_LIST_BATCH_SIZE
  }
}

export async function loadPrimaryTimeBlocksForTasks(
  executor: DatabaseExecutor,
  workspaceId: string,
  taskRows: TaskRow[],
): Promise<Map<string, Pick<TaskTimeBlockRow, 'ends_at' | 'starts_at'>>> {
  const taskIds = taskRows.map((taskRow) => taskRow.id)

  if (taskIds.length === 0) {
    return new Map()
  }

  const timeBlockRows = await executor
    .selectFrom('app.task_time_blocks')
    .select(['task_id', 'starts_at', 'ends_at'])
    .where('workspace_id', '=', workspaceId)
    .where('task_id', 'in', taskIds)
    .where('deleted_at', 'is', null)
    .orderBy('task_id', 'asc')
    .orderBy('position', 'asc')
    .orderBy('starts_at', 'asc')
    .execute()
  const primaryTimeBlocks = new Map<
    string,
    Pick<TaskTimeBlockRow, 'ends_at' | 'starts_at'>
  >()

  for (const timeBlockRow of timeBlockRows) {
    if (primaryTimeBlocks.has(timeBlockRow.task_id)) {
      continue
    }

    primaryTimeBlocks.set(timeBlockRow.task_id, {
      ends_at: timeBlockRow.ends_at,
      starts_at: timeBlockRow.starts_at,
    })
  }

  return primaryTimeBlocks
}

export async function loadProjectTitlesForTasks(
  executor: DatabaseExecutor,
  workspaceId: string,
  taskRows: TaskRow[],
): Promise<Map<string, string>> {
  const projectIds = [
    ...new Set(
      taskRows
        .map((taskRow) => taskRow.project_id)
        .filter((projectId): projectId is string => projectId !== null),
    ),
  ]

  if (projectIds.length === 0) {
    return new Map()
  }

  const projectRows = await executor
    .selectFrom('app.projects')
    .select(['id', 'title'])
    .where('workspace_id', '=', workspaceId)
    .where('id', 'in', projectIds)
    .where('deleted_at', 'is', null)
    .execute()

  return new Map(
    projectRows.map((projectRow) => [projectRow.id, projectRow.title]),
  )
}

export async function loadAssigneeDisplayNamesForTasks(
  executor: DatabaseExecutor,
  taskRows: TaskRow[],
): Promise<Map<string, string>> {
  const assigneeUserIds = getDistinctTaskUserIds(
    taskRows,
    (taskRow) => taskRow.assignee_user_id,
  )

  if (assigneeUserIds.length === 0) {
    return new Map()
  }

  return loadUserDisplayNames(executor, assigneeUserIds)
}

export async function loadAuthorDisplayNamesForTasks(
  executor: DatabaseExecutor,
  taskRows: TaskRow[],
): Promise<Map<string, string>> {
  const authorUserIds = getDistinctTaskUserIds(
    taskRows,
    (taskRow) => taskRow.created_by,
  )

  if (authorUserIds.length === 0) {
    return new Map()
  }

  return loadUserDisplayNames(executor, authorUserIds)
}

export function loadPrimaryTimeBlock(
  executor: DatabaseExecutor,
  workspaceId: string,
  taskId: string,
): Promise<TaskTimeBlockRow | undefined> {
  return executor
    .selectFrom('app.task_time_blocks')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('task_id', '=', taskId)
    .where('deleted_at', 'is', null)
    .orderBy('position', 'asc')
    .orderBy('starts_at', 'asc')
    .executeTakeFirst()
}

export async function resolveTaskProject(
  db: Kysely<DatabaseSchema>,
  context: CreateTaskCommand['context'],
  projectId: string | null,
): Promise<ResolvedTaskProject | null> {
  if (!projectId) {
    return null
  }

  const project = await withOptionalRls(
    db,
    context.auth,
    (executor) => loadActiveProject(executor, context.workspaceId, projectId),
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

export async function resolveTaskAssignee(
  db: Kysely<DatabaseSchema>,
  context: CreateTaskCommand['context'],
  assigneeUserId: string | null,
): Promise<ResolvedTaskAssignee | null> {
  if (!assigneeUserId) {
    return null
  }

  if (context.workspaceKind !== 'shared') {
    throw new HttpError(
      400,
      'task_assignee_shared_workspace_required',
      'Task assignees are supported only in shared workspaces.',
    )
  }

  const assignee = await withOptionalRls(
    db,
    context.auth,
    (executor) =>
      loadActiveWorkspaceAssignee(
        executor,
        context.workspaceId,
        assigneeUserId,
      ),
    context.actorUserId,
  )

  if (!assignee) {
    throw new HttpError(
      400,
      'task_assignee_not_found',
      'The selected assignee is not a participant of this workspace.',
    )
  }

  return assignee
}

export async function loadProjectTitle(
  executor: DatabaseExecutor,
  workspaceId: string,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) {
    return null
  }

  const project = await loadActiveProject(executor, workspaceId, projectId)

  return project?.title ?? null
}

export function loadActiveProject(
  executor: DatabaseExecutor,
  workspaceId: string,
  projectId: string,
): Promise<Pick<ProjectRow, 'id' | 'title'> | undefined> {
  return executor
    .selectFrom('app.projects')
    .select(['id', 'title'])
    .where('id', '=', projectId)
    .where('workspace_id', '=', workspaceId)
    .where('deleted_at', 'is', null)
    .where('status', '=', 'active')
    .executeTakeFirst()
}

export function loadActiveWorkspaceAssignee(
  executor: DatabaseExecutor,
  workspaceId: string,
  assigneeUserId: string,
): Promise<ResolvedTaskAssignee | undefined> {
  return executor
    .selectFrom('app.workspace_members as membership')
    .innerJoin('app.users as actor', 'actor.id', 'membership.user_id')
    .select(['actor.display_name as displayName', 'actor.id as id'])
    .where('membership.workspace_id', '=', workspaceId)
    .where('membership.user_id', '=', assigneeUserId)
    .where('membership.deleted_at', 'is', null)
    .where('actor.deleted_at', 'is', null)
    .executeTakeFirst()
}

export async function loadAssigneeDisplayName(
  executor: DatabaseExecutor,
  assigneeUserId: string | null,
): Promise<string | null> {
  return loadUserDisplayName(executor, assigneeUserId)
}

export async function loadUserDisplayName(
  executor: DatabaseExecutor,
  userId: string | null,
): Promise<string | null> {
  if (!userId) {
    return null
  }

  const user = await executor
    .selectFrom('app.users')
    .select('display_name')
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()

  return user?.display_name ?? null
}

export async function loadUserDisplayNames(
  executor: DatabaseExecutor,
  userIds: string[],
): Promise<Map<string, string>> {
  const rows = await executor
    .selectFrom('app.users')
    .select(['id', 'display_name'])
    .where('id', 'in', userIds)
    .where('deleted_at', 'is', null)
    .execute()

  return new Map(rows.map((row) => [row.id, row.display_name]))
}

export function loadCurrentTask(
  executor: DatabaseExecutor,
  command: {
    context: {
      workspaceId: string
    }
    taskId: string
  },
): Promise<Pick<TaskRow, 'id' | 'version'> | undefined> {
  return executor
    .selectFrom('app.tasks')
    .select(['id', 'version'])
    .where('id', '=', command.taskId)
    .where('workspace_id', '=', command.context.workspaceId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
}

function getDistinctTaskUserIds(
  taskRows: TaskRow[],
  selector: (taskRow: TaskRow) => string | null,
): string[] {
  return [
    ...new Set(
      taskRows
        .map(selector)
        .filter((userId): userId is string => userId !== null),
    ),
  ]
}

function applyTaskListFilters(
  query: TaskRowsQuery,
  filters?: TaskListFilters,
): TaskRowsQuery {
  if (!filters) {
    return query
  }

  let filteredQuery = query

  if (filters.status) {
    filteredQuery = filteredQuery.where('status', '=', filters.status)
  }

  if (filters.plannedDate) {
    filteredQuery = filteredQuery.where('planned_on', '=', filters.plannedDate)
  }

  if (filters.project) {
    filteredQuery = filteredQuery.where(
      buildLegacyProjectTitleFilter(filters.project),
    )
  }

  if (filters.projectId) {
    filteredQuery = filteredQuery.where('project_id', '=', filters.projectId)
  }

  if (filters.sphereId) {
    const sphereId = filters.sphereId

    filteredQuery = filteredQuery.where((expressionBuilder) =>
      expressionBuilder.or([
        expressionBuilder('project_id', '=', sphereId),
        expressionBuilder('sphere_id', '=', sphereId),
      ]),
    )
  }

  return filteredQuery
}

function buildLegacyProjectTitleFilter(projectTitle: string) {
  return sql<boolean>`
    (
      app.tasks.metadata ->> ${LEGACY_PROJECT_NAME_KEY} = ${projectTitle}
      or exists (
        select 1
        from app.projects
        where app.projects.id = app.tasks.project_id
          and app.projects.workspace_id = app.tasks.workspace_id
          and app.projects.deleted_at is null
          and app.projects.title = ${projectTitle}
      )
    )
  `
}
