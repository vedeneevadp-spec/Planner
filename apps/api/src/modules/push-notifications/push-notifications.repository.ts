import type {
  PushDeviceRecord,
  PushDeviceUpsertInput,
  PushNotificationRecipient,
  PushNotificationSession,
} from './push-notifications.model.js'

export interface PushNotificationsRepository {
  deactivateTokens: (
    tokens: readonly string[],
    recipient?: PushNotificationRecipient | PushNotificationSession,
  ) => Promise<void>
  listActiveTokens: (
    recipient: PushNotificationRecipient | PushNotificationSession,
  ) => Promise<string[]>
  removeDevice: (
    session: PushNotificationSession,
    installationId: string,
  ) => Promise<void>
  upsertDevice: (
    session: PushNotificationSession,
    input: PushDeviceUpsertInput,
  ) => Promise<PushDeviceRecord>
}
