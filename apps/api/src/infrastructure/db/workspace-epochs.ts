import { sql } from 'kysely'

import type { DatabaseConnection } from './client.js'

export async function readWorkspaceEpoch(
  database: DatabaseConnection | null,
  userId: string,
  workspaceId: string,
): Promise<string> {
  if (!database) return '0'
  const result = await sql<{ epoch: string | null }>`
    select app.read_workspace_write_epoch(${userId}::uuid, ${workspaceId}::uuid) as epoch
  `.execute(database.db)
  if (result.rows[0]?.epoch == null)
    throw new Error('Workspace epoch is unavailable.')
  return result.rows[0].epoch
}

export function isWorkspaceEpochConflict(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'P4009'
}
