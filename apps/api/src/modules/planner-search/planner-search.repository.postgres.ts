import type { PlannerSearchItem, PlannerSearchQuery } from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { withOptionalRls } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type { TaskReadContext } from '../tasks/task.model.js'

// Search selects only display fields and at most limit + 1 rows. It never
// constructs full cleaning/self-care histories, details or occurrence graphs.
export class PostgresPlannerSearchRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  search(
    source: 'cleaning' | 'care',
    context: TaskReadContext,
    query: PlannerSearchQuery,
  ) {
    if (source === 'care' && context.workspaceKind === 'shared') {
      return Promise.resolve({ items: [], hasMore: false })
    }
    const pattern = `%${query.query.replace(/[\\%_]/g, '\\$&')}%`
    const offset = (query.page - 1) * query.limit
    return withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const result =
          source === 'cleaning'
            ? await sql<PlannerSearchItem>`
          select t.id, 'cleaning'::text as source, t.title, t.description,
            coalesce(z.title, 'Общая уборка') as context, s.next_due_at::text as date,
            case when t.is_active then 'active' else 'archived' end as status
          from app.cleaning_tasks t
          left join app.cleaning_zones z on z.id = t.zone_id and z.deleted_at is null
          left join app.cleaning_task_states s on s.task_id = t.id
          where t.workspace_id = ${context.workspaceId}::uuid and t.deleted_at is null
            and (${query.includeCompleted} or t.is_active)
            and (t.title || ' ' || t.description) ilike ${pattern}
          order by t.title, t.id limit ${query.limit + 1} offset ${offset}
        `.execute(executor)
            : await sql<PlannerSearchItem>`
          select i.id, 'care'::text as source, i.title, i.description,
            'Забота о себе'::text as context, null::text as date,
            case when i.is_archived then 'archived' else 'active' end as status
          from app.self_care_items i
          where i.workspace_id = ${context.workspaceId}::uuid and i.deleted_at is null
            and i.user_id = ${context.actorUserId ?? context.auth?.claims.sub}::uuid
            and (${query.includeCompleted} or not i.is_archived)
            and (i.title || ' ' || i.description) ilike ${pattern}
          order by i.title, i.id limit ${query.limit + 1} offset ${offset}
        `.execute(executor)
        return {
          items: result.rows.slice(0, query.limit),
          hasMore: result.rows.length > query.limit,
        }
      },
      context.actorUserId,
    )
  }
}
