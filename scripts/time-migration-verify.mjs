import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const connectionString =
  process.env.TIME_MIGRATION_VERIFY_DATABASE_URL ??
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const limit = readPositiveIntegerEnv('TIME_MIGRATION_VERIFY_LIMIT', 100)
const failOnSuspicious =
  process.env.TIME_MIGRATION_VERIFY_FAIL_ON_SUSPICIOUS === '1'

const client = new Client(createPgConnectionConfig(connectionString))

try {
  await client.connect()
  await preparePgAdminConnection(client)

  const result = await client.query(getVerificationSql(), [limit])
  const rows = result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    workspaceId: row.workspace_id,
    timeKind: row.time_kind,
    localDate: row.local_date,
    localTime: row.local_time,
    timeZone: row.time_zone,
    timeZoneInferred: row.time_zone_inferred,
    startsAtUtc: row.starts_at_utc,
    expectedStartsAtUtc: row.expected_starts_at_utc,
    legacyStartsAt: row.legacy_starts_at,
    legacyTimeZone: row.legacy_time_zone,
    legacyUtcClockTime: row.legacy_utc_clock_time,
    reasons: row.reasons,
  }))

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        limit,
        suspiciousCount: rows.length,
        rows,
      },
      null,
      2,
    ),
  )

  if (failOnSuspicious && rows.length > 0) {
    throw new Error(
      `Found ${rows.length} suspicious migrated task time records.`,
    )
  }
} finally {
  await closePgClient(client)
}

function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name]

  if (!rawValue) {
    return fallback
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${rawValue}`)
  }

  return value
}

function getVerificationSql() {
  return `
with primary_block as (
  select distinct on (block.workspace_id, block.task_id)
    block.workspace_id,
    block.task_id,
    block.starts_at as legacy_starts_at,
    block.timezone as legacy_time_zone
  from app.task_time_blocks block
  where block.deleted_at is null
  order by
    block.workspace_id,
    block.task_id,
    block.starts_at asc,
    block.id asc
),
task_time_check as (
  select
    task.id,
    task.title,
    task.workspace_id,
    task.time_kind,
    task.local_date::text as local_date,
    left(task.local_time::text, 5) as local_time,
    task.time_zone,
    task.time_zone_inferred,
    task.starts_at_utc,
    case
      when task.local_date is not null
        and task.local_time is not null
        and task.time_zone is not null
      then ((task.local_date::timestamp + task.local_time) at time zone task.time_zone)
      else null
    end as expected_starts_at_utc,
    primary_block.legacy_starts_at,
    primary_block.legacy_time_zone,
    case
      when primary_block.legacy_starts_at is not null
      then left((primary_block.legacy_starts_at at time zone 'UTC')::time::text, 5)
      else null
    end as legacy_utc_clock_time,
    array_remove(array[
      case
        when task.time_kind = 'date_only'
          and (task.local_date is null or task.local_time is not null or task.starts_at_utc is not null)
        then 'date_only_shape_invalid'
      end,
      case
        when task.time_kind = 'fixed_zone_datetime'
          and (
            task.local_date is null
            or task.local_time is null
            or task.time_zone is null
            or task.starts_at_utc is null
          )
        then 'fixed_zone_missing_required_field'
      end,
      case
        when task.time_kind = 'fixed_zone_datetime'
          and task.local_date is not null
          and task.local_time is not null
          and task.time_zone is not null
          and task.starts_at_utc is not null
          and abs(extract(epoch from (
            task.starts_at_utc - ((task.local_date::timestamp + task.local_time) at time zone task.time_zone)
          ))) > 60
        then 'starts_at_utc_mismatch'
      end,
      case
        when task.time_kind = 'fixed_zone_datetime'
          and task.local_time is not null
          and task.time_zone is not null
          and task.starts_at_utc is not null
          and left((task.starts_at_utc at time zone task.time_zone)::time::text, 5) <> left(task.local_time::text, 5)
        then 'local_time_not_recovered_from_starts_at_utc'
      end,
      case
        when task.time_kind = 'fixed_zone_datetime'
          and primary_block.legacy_starts_at is not null
          and task.local_time is not null
          and left((primary_block.legacy_starts_at at time zone 'UTC')::time::text, 5) <> left(task.local_time::text, 5)
        then 'legacy_clock_time_mismatch'
      end,
      case
        when task.time_kind = 'fixed_zone_datetime'
          and primary_block.legacy_starts_at is not null
          and task.starts_at_utc is not null
          and abs(extract(epoch from (task.starts_at_utc - primary_block.legacy_starts_at))) > 60
        then 'legacy_instant_differs_from_new_starts_at_utc'
      end,
      case
        when task.time_kind = 'floating_local_time'
          and (task.local_time is null or task.starts_at_utc is not null)
        then 'floating_local_time_shape_invalid'
      end
    ], null) as reasons
  from app.tasks task
  left join primary_block
    on primary_block.workspace_id = task.workspace_id
   and primary_block.task_id = task.id
  where task.deleted_at is null
    and task.time_kind is not null
)
select *
from task_time_check
where cardinality(reasons) > 0
order by
  cardinality(reasons) desc,
  workspace_id,
  id
limit $1
`
}
