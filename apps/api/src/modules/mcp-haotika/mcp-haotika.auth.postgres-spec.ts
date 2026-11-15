import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import { sql } from 'kysely'

import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import {
  cleanupRepositoryContractUsers,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import { PostgresMcpOAuthTokenRepository } from './mcp-haotika.auth.js'
import type { RotateMcpOAuthTokenCommand } from './mcp-haotika.types.js'

const connection = createDatabaseConnection(createDatabaseConfig())
const userId = randomUUID()
const issuer = 'https://mcp-rotation.example.test'
const repository = new PostgresMcpOAuthTokenRepository(connection.db)

void describe('Postgres MCP refresh rotation', () => {
  before(async () => {
    await seedRepositoryContractWorkspace(connection, { userId })
  })
  after(async () => {
    await cleanupRepositoryContractUsers(connection, [userId])
    await destroyDatabaseConnection(connection)
  })

  async function seed() {
    const refreshTokenHash = randomUUID()
    await repository.createToken({
      accessTokenHash: randomUUID(),
      refreshTokenHash,
      clientId: 'chatgpt',
      issuer,
      resource: `${issuer}/mcp`,
      scopes: ['haotika:tasks.read'],
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    return refreshTokenHash
  }
  function command(refreshTokenHash: string): RotateMcpOAuthTokenCommand {
    return {
      refreshTokenHash,
      clientId: 'chatgpt',
      issuer,
      resource: `${issuer}/mcp`,
      nextAccessTokenHash: randomUUID(),
      nextRefreshTokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    }
  }
  function rotateAsRuntime(input: RotateMcpOAuthTokenCommand) {
    return connection.db.transaction().execute(async (trx) => {
      await sql`set local role authenticated`.execute(trx)
      return new PostgresMcpOAuthTokenRepository(trx).rotateRefreshToken(input)
    })
  }

  void it('allows only one runtime transaction to rotate a token and rejects another client', async () => {
    const refreshTokenHash = await seed()
    assert.equal(
      await rotateAsRuntime({
        ...command(refreshTokenHash),
        clientId: 'other-client',
      }),
      null,
    )
    const original = await repository.findByRefreshTokenHash(refreshTokenHash)
    const results = await Promise.all([
      rotateAsRuntime(command(refreshTokenHash)),
      rotateAsRuntime(command(refreshTokenHash)),
    ])
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal(results.find(Boolean)?.createdAt, original?.createdAt)
    assert.equal(results.find(Boolean)?.userId, userId)
    assert.deepEqual(results.find(Boolean)?.scopes, ['haotika:tasks.read'])
    assert.equal(
      await repository.findByRefreshTokenHash(refreshTokenHash),
      null,
    )
  })

  void it('rolls back consumption if successor insertion fails', async () => {
    const refreshTokenHash = await seed()
    const occupied = command(await seed())
    await rotateAsRuntime(occupied)
    await assert.rejects(
      rotateAsRuntime({
        ...command(refreshTokenHash),
        nextAccessTokenHash: occupied.nextAccessTokenHash,
      }),
    )
    assert.ok(await repository.findByRefreshTokenHash(refreshTokenHash))
    assert.ok(await rotateAsRuntime(command(refreshTokenHash)))
  })
})
