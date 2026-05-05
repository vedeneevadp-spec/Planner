import { type Kysely, type Selectable } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  PushDeviceRecord,
  PushDeviceUpsertInput,
  PushNotificationSession,
} from './push-notifications.model.js'
import type { PushNotificationsRepository } from './push-notifications.repository.js'

type PushDeviceRow = Selectable<DatabaseSchema['app.push_devices']>

export class PostgresPushNotificationsRepository implements PushNotificationsRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async upsertDevice(
    session: PushNotificationSession,
    input: PushDeviceUpsertInput,
  ): Promise<PushDeviceRecord> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('app.push_devices')
        .set({
          deleted_at: new Date(),
        })
        .where('platform', '=', input.platform)
        .where('token', '=', input.token)
        .where('installation_id', '!=', input.installationId)
        .where('deleted_at', 'is', null)
        .execute()

      const row = await trx
        .insertInto('app.push_devices')
        .values({
          app_version: input.appVersion ?? null,
          deleted_at: null,
          device_name: input.deviceName ?? null,
          installation_id: input.installationId,
          last_registered_at: new Date().toISOString(),
          locale: input.locale ?? null,
          platform: input.platform,
          token: input.token,
          user_id: session.actorUserId,
          workspace_id: session.workspaceId,
        })
        .onConflict((conflict) =>
          conflict.columns(['platform', 'installation_id']).doUpdateSet({
            app_version: input.appVersion ?? null,
            deleted_at: null,
            device_name: input.deviceName ?? null,
            last_registered_at: new Date().toISOString(),
            locale: input.locale ?? null,
            token: input.token,
            user_id: session.actorUserId,
            workspace_id: session.workspaceId,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow()

      return mapPushDeviceRecord(row)
    })
  }

  async removeDevice(
    session: PushNotificationSession,
    installationId: string,
  ): Promise<void> {
    await this.db
      .updateTable('app.push_devices')
      .set({
        deleted_at: new Date(),
      })
      .where('installation_id', '=', installationId)
      .where('platform', '=', 'android')
      .where('user_id', '=', session.actorUserId)
      .where('workspace_id', '=', session.workspaceId)
      .where('deleted_at', 'is', null)
      .execute()
  }

  async listActiveTokens(session: PushNotificationSession): Promise<string[]> {
    const rows = await this.db
      .selectFrom('app.push_devices')
      .select('token')
      .where('user_id', '=', session.actorUserId)
      .where('workspace_id', '=', session.workspaceId)
      .where('deleted_at', 'is', null)
      .orderBy('last_registered_at', 'desc')
      .execute()

    return rows.map((row) => row.token)
  }

  async deactivateTokens(tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) {
      return
    }

    await this.db
      .updateTable('app.push_devices')
      .set({
        deleted_at: new Date(),
      })
      .where('token', 'in', [...tokens])
      .where('deleted_at', 'is', null)
      .execute()
  }
}

function mapPushDeviceRecord(row: PushDeviceRow): PushDeviceRecord {
  return {
    appVersion: row.app_version,
    createdAt: serializeTimestamp(row.created_at),
    deletedAt: serializeNullableTimestamp(row.deleted_at),
    deviceName: row.device_name,
    id: row.id,
    installationId: row.installation_id,
    lastRegisteredAt: serializeTimestamp(row.last_registered_at),
    locale: row.locale,
    platform: row.platform,
    token: row.token,
    updatedAt: serializeTimestamp(row.updated_at),
    userId: row.user_id,
    version: row.version,
    workspaceId: row.workspace_id,
  }
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
