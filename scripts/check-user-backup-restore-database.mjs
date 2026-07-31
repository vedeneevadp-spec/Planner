import { Client } from 'pg'

const connectionString = process.env.USER_BACKUP_RESTORE_DATABASE_URL?.trim()

if (!connectionString) {
  throw new Error('USER_BACKUP_RESTORE_DATABASE_URL is required.')
}

const tablePrivileges = new Map([
  ['users', 'SELECT,UPDATE'],
  ['workspaces', 'SELECT,UPDATE'],
  ['user_backup_restore_operations', 'SELECT,INSERT,UPDATE'],
  ['projects', 'SELECT,INSERT,UPDATE'],
  ['task_templates', 'SELECT,INSERT,UPDATE'],
  ['task_chains', 'SELECT,INSERT,UPDATE'],
  ['tasks', 'SELECT,INSERT,UPDATE'],
  ['task_time_blocks', 'SELECT,INSERT,UPDATE'],
  ['task_occurrences', 'SELECT,INSERT'],
  ['daily_plans', 'SELECT,INSERT,UPDATE'],
  ['chaos_inbox_items', 'SELECT,INSERT,UPDATE'],
  ['cleaning_zones', 'SELECT,INSERT,UPDATE'],
  ['cleaning_tasks', 'SELECT,INSERT,UPDATE'],
  ['cleaning_task_states', 'SELECT,INSERT'],
  ['cleaning_task_history', 'SELECT,INSERT'],
  ['habits', 'SELECT,INSERT,UPDATE'],
  ['habit_entries', 'SELECT,INSERT,UPDATE'],
  ['self_care_items', 'SELECT,INSERT,UPDATE'],
  ['self_care_item_alternatives', 'SELECT,INSERT'],
  ['self_care_schedule_rules', 'SELECT,INSERT'],
  ['self_care_ritual_steps', 'SELECT,INSERT'],
  ['self_care_occurrences', 'SELECT,INSERT'],
  ['self_care_completions', 'SELECT,INSERT'],
  ['self_care_ritual_step_completions', 'SELECT,INSERT'],
  ['self_care_ritual_step_drafts', 'SELECT,INSERT'],
  ['self_care_procedure_details', 'SELECT,INSERT'],
  ['self_care_appointment_details', 'SELECT,INSERT'],
  ['self_care_medical_details', 'SELECT,INSERT'],
  ['self_care_course_details', 'SELECT,INSERT'],
  ['self_care_measurement_details', 'SELECT,INSERT'],
  ['self_care_exercise_details', 'SELECT,INSERT'],
  ['self_care_daily_states', 'SELECT,INSERT'],
  ['self_care_settings', 'SELECT,INSERT'],
  ['self_care_minimum_items', 'SELECT,INSERT'],
])
const client = new Client({
  connectionString,
  connectionTimeoutMillis: 15_000,
  query_timeout: 30_000,
})

try {
  await client.connect()

  const runtime = await client.query(`
    select
      current_user as role_name,
      current_setting('transaction_read_only') as transaction_read_only,
      roles.rolbypassrls,
      roles.rolsuper
    from pg_roles roles
    where roles.rolname = current_user
  `)
  const role = runtime.rows[0]

  if (!role || role.transaction_read_only !== 'off') {
    throw new Error('User backup restore database must be read-write.')
  }

  for (const [tableName, privileges] of tablePrivileges) {
    const relationName = `app.${tableName}`
    const access = await client.query(
      `
        select
          has_table_privilege(current_user, $1, $2) as has_privileges,
          pg_has_role(
            current_user,
            pg_class.relowner,
            'USAGE'
          ) as has_owner_privileges
        from pg_class
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'app'
          and pg_class.relname = $3
          and pg_class.relkind in ('p', 'r')
      `,
      [relationName, privileges, tableName],
    )
    const table = access.rows[0]

    if (!table) {
      throw new Error(`User backup restore table is missing: ${relationName}`)
    }

    if (!table.has_privileges) {
      throw new Error(
        `User backup restore role lacks ${privileges} on ${relationName}.`,
      )
    }

    if (!role.rolsuper && !role.rolbypassrls && !table.has_owner_privileges) {
      throw new Error(
        `User backup restore role cannot bypass RLS on ${relationName}.`,
      )
    }
  }

  console.log(
    `User backup restore database check passed for ${tablePrivileges.size} tables.`,
  )
} finally {
  await client.end().catch(() => undefined)
}
