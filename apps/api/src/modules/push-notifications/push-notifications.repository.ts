import type {
  PushDeviceRecord,
  PushDeviceUpsertInput,
  PushNotificationSession,
} from './push-notifications.model.js'

export interface PushNotificationsRepository {
  deactivateTokens: (tokens: readonly string[]) => Promise<void>
  listActiveTokens: (session: PushNotificationSession) => Promise<string[]>
  removeDevice: (
    session: PushNotificationSession,
    installationId: string,
  ) => Promise<void>
  upsertDevice: (
    session: PushNotificationSession,
    input: PushDeviceUpsertInput,
  ) => Promise<PushDeviceRecord>
}
