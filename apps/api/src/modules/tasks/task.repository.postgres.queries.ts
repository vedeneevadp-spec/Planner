import { type Kysely, type SelectQueryBuilder, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import { LifeSphereNotFoundError } from '../life-spheres/life-sphere.errors.js'
import type {
  CreateTaskCommand,
  TaskCursorPageQuery,
  TaskListFilters,
} from './task.model.js'
import {
  LEGACY_PROJECT_NAME_KEY,
  type ProjectRow,
  type ResolvedTaskAssignee,
  type ResolvedTaskProject,
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
  const taskRows =
    filters?.limit !== undefined || filters?.offset !== undefined
      ? await loadTaskRowsPage(executor, workspaceId, {
          ...filters,
          limit: filters.limit ?? 100,
          offset: filters.offset ?? 0,
        })
      : await loadTaskRows(executor, workspaceId, filters)

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
      time_block_timezone: timeBlock?.timezone ?? null,
    }
  })
}

export async function loadTaskRowsCursorWithPrimaryTimeBlock(
  executor: DatabaseExecutor,
  workspaceId: string,
  query: TaskCursorPageQuery,
): Promise<{ rows: TaskListRow[]; totalCount: number }> {
  if (query.limit === 0) {
    return {
      rows: [],
      totalCount: await countTaskRowsForCursor(executor, workspaceId, query),
    }
  }

  const [taskRows, totalCount] = await Promise.all([
    loadTaskRowsCursorPage(executor, workspaceId, query),
    countTaskRowsForCursor(executor, workspaceId, query),
  ])

  if (taskRows.length === 0) {
    return { rows: [], totalCount }
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

  return {
    rows: taskRows.map((taskRow) => {
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
        time_block_timezone: timeBlock?.timezone ?? null,
      }
    }),
    totalCount,
  }
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
      time_block_timezone: timeBlock?.timezone ?? null,
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

export function loadTaskRowsCursorPage(
  executor: DatabaseExecutor,
  workspaceId: string,
  cursorQuery: TaskCursorPageQuery,
): Promise<TaskRow[]> {
  const closedPriority = sql<number>`
    case when app.tasks.status = 'archived' then 0 else 1 end
  `
  let query = applyTaskCursorFilters(
    executor
      .selectFrom('app.tasks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null),
    cursorQuery,
  )

  if (cursorQuery.anchor) {
    const comparison = cursorQuery.direction === 'asc' ? sql`>` : sql`<`

    if (cursorQuery.scope === 'closed') {
      if (cursorQuery.anchor.closedPriority === null) {
        throw new HttpError(
          400,
          'invalid_task_cursor',
          'Closed task cursor requires a priority anchor.',
        )
      }

      query = query.where(sql<boolean>`
        (
          ${closedPriority} > ${cursorQuery.anchor.closedPriority}
          or (
            ${closedPriority} = ${cursorQuery.anchor.closedPriority}
            and (app.tasks.created_at, app.tasks.id)
              ${comparison}
              (${cursorQuery.anchor.createdAt}::timestamptz, ${cursorQuery.anchor.id}::uuid)
          )
        )
      `)
    } else {
      query = query.where(sql<boolean>`
        (app.tasks.created_at, app.tasks.id)
        ${comparison}
        (${cursorQuery.anchor.createdAt}::timestamptz, ${cursorQuery.anchor.id}::uuid)
      `)
    }
  }

  if (cursorQuery.scope === 'closed') {
    query = query.orderBy(closedPriority, 'asc')
  }

  return query
    .orderBy('created_at', cursorQuery.direction === 'asc' ? 'asc' : 'desc')
    .orderBy('id', cursorQuery.direction === 'asc' ? 'asc' : 'desc')
    .limit(cursorQuery.limit + 1)
    .execute()
}

async function countTaskRowsForCursor(
  executor: DatabaseExecutor,
  workspaceId: string,
  cursorQuery: TaskCursorPageQuery,
): Promise<number> {
  const result = await applyTaskCursorFilters(
    executor
      .selectFrom('app.tasks')
      .select((expressionBuilder) =>
        expressionBuilder.fn.countAll().as('count'),
      )
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null),
    cursorQuery,
  ).executeTakeFirstOrThrow()

  return Number(result.count)
}

export function loadTaskRows(
  executor: DatabaseExecutor,
  workspaceId: string,
  filters?: TaskListFilters,
): Promise<TaskRow[]> {
  return applyTaskListFilters(
    executor
      .selectFrom('app.tasks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null),
    filters,
  )
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()
}

export async function loadPrimaryTimeBlocksForTasks(
  executor: DatabaseExecutor,
  workspaceId: string,
  taskRows: TaskRow[],
): Promise<
  Map<string, Pick<TaskTimeBlockRow, 'ends_at' | 'starts_at' | 'timezone'>>
> {
  const taskIds = taskRows.map((taskRow) => taskRow.id)

  if (taskIds.length === 0) {
    return new Map()
  }

  const timeBlockRows = await executor
    .selectFrom('app.task_time_blocks')
    .select(['task_id', 'starts_at', 'ends_at', 'timezone'])
    .where('workspace_id', '=', workspaceId)
    .where('task_id', 'in', taskIds)
    .where('deleted_at', 'is', null)
    .orderBy('task_id', 'asc')
    .orderBy('position', 'asc')
    .orderBy('starts_at', 'asc')
    .execute()
  const primaryTimeBlocks = new Map<
    string,
    Pick<TaskTimeBlockRow, 'ends_at' | 'starts_at' | 'timezone'>
  >()

  for (const timeBlockRow of timeBlockRows) {
    if (primaryTimeBlocks.has(timeBlockRow.task_id)) {
      continue
    }

    primaryTimeBlocks.set(timeBlockRow.task_id, {
      ends_at: timeBlockRow.ends_at,
      starts_at: timeBlockRow.starts_at,
      timezone: timeBlockRow.timezone,
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
  return withOptionalRls(
    db,
    context.auth,
    (executor) => resolveTaskProjectInExecutor(executor, context, projectId),
    context.actorUserId,
  )
}

export async function resolveTaskProjectInExecutor(
  executor: DatabaseExecutor,
  context: CreateTaskCommand['context'],
  projectId: string | null,
): Promise<ResolvedTaskProject | null> {
  if (!projectId) {
    return null
  }

  const project = await loadActiveProject(
    executor,
    context.workspaceId,
    projectId,
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
  return withOptionalRls(
    db,
    context.auth,
    (executor) =>
      resolveTaskAssigneeInExecutor(executor, context, assigneeUserId),
    context.actorUserId,
  )
}

export async function resolveTaskAssigneeInExecutor(
  executor: DatabaseExecutor,
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

  const assignee = await loadActiveWorkspaceAssignee(
    executor,
    context.workspaceId,
    assigneeUserId,
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
    const plannedDate = filters.plannedDate
    filteredQuery = filteredQuery.where((expressionBuilder) =>
      expressionBuilder.or([
        expressionBuilder('local_date', '=', plannedDate),
        expressionBuilder('planned_on', '=', plannedDate),
      ]),
    )
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

function applyTaskCursorFilters<Output>(
  query: SelectQueryBuilder<DatabaseSchema, 'app.tasks', Output>,
  cursorQuery: TaskCursorPageQuery,
): SelectQueryBuilder<DatabaseSchema, 'app.tasks', Output> {
  let filteredQuery = query

  if (cursorQuery.scope === 'active') {
    filteredQuery = filteredQuery.where('status', 'in', [
      'todo',
      'in_progress',
      'ready_for_review',
    ])
  } else if (cursorQuery.scope === 'closed') {
    filteredQuery = filteredQuery.where('status', 'in', ['done', 'archived'])
  }

  if (cursorQuery.dateFrom && cursorQuery.dateTo) {
    filteredQuery = filteredQuery.where(
      cursorQuery.dateMode === 'planned'
        ? sql<boolean>`
            coalesce(app.tasks.local_date, app.tasks.planned_on)
            between ${cursorQuery.dateFrom}::date and ${cursorQuery.dateTo}::date
          `
        : sql<boolean>`
            coalesce(
              app.tasks.local_date,
              app.tasks.planned_on,
              app.tasks.due_on,
              (app.tasks.completed_at at time zone 'UTC')::date
            ) between ${cursorQuery.dateFrom}::date and ${cursorQuery.dateTo}::date
          `,
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
