import { Client } from 'pg'

import { createPgConnectionConfig } from './pg-connection-config.mjs'

export async function withInfrastructureBackupSnapshot(
  connectionString,
  backup,
  options = {},
) {
  const client =
    options.client ?? new Client(createPgConnectionConfig(connectionString))
  await client.connect()
  try {
    await client.query('begin isolation level repeatable read read only')
    const snapshot = await client.query(
      'select pg_export_snapshot() as snapshot_id',
    )
    const references = await client.query(`
      select avatar_url as value, 'profile' as kind
      from app.users
      where avatar_url like '%/api/v1/profile-assets/%'
      union all
      select value, 'icon' as kind
      from app.emoji_assets
      where deleted_at is null and value like '%/api/v1/icon-assets/%'
    `)
    const paths = [...new Set(references.rows.map(assetReferencePath))].sort()
    return await backup({
      snapshotId: snapshot.rows[0].snapshot_id,
      assetReferences: paths,
    })
  } finally {
    try {
      await client.query('rollback')
    } finally {
      await client.end()
    }
  }
}

function assetReferencePath(reference) {
  const prefix =
    reference.kind === 'profile'
      ? '/api/v1/profile-assets/'
      : '/api/v1/icon-assets/'
  const url = new URL(reference.value, 'https://planner.invalid')
  if (!url.pathname.startsWith(prefix))
    throw new Error('Unsupported database asset reference.')
  const name = decodeURIComponent(url.pathname.slice(prefix.length))
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error('Unsafe database asset reference.')
  }
  return reference.kind === 'profile' ? `profiles/${name}` : name
}
