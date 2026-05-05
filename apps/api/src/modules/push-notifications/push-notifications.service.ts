import { HttpError } from '../../bootstrap/http-error.js'
import type {
  PushDeviceUpsertInput,
  PushNotificationSender,
  PushNotificationSession,
  PushTestNotificationInput,
  PushTestNotificationResponse,
} from './push-notifications.model.js'
import type { PushNotificationsRepository } from './push-notifications.repository.js'

export class PushNotificationsService {
  constructor(
    private readonly repository: PushNotificationsRepository,
    private readonly sender: PushNotificationSender,
  ) {}

  upsertDevice(session: PushNotificationSession, input: PushDeviceUpsertInput) {
    return this.repository.upsertDevice(session, input)
  }

  removeDevice(session: PushNotificationSession, installationId: string) {
    return this.repository.removeDevice(session, installationId)
  }

  async sendTestNotification(
    session: PushNotificationSession,
    input: PushTestNotificationInput,
  ): Promise<PushTestNotificationResponse> {
    if (!this.sender.isAvailable()) {
      throw new HttpError(
        503,
        'push_notifications_not_configured',
        'Firebase push notifications are not configured on the server.',
      )
    }

    const tokens = await this.repository.listActiveTokens(session)

    if (tokens.length === 0) {
      return {
        deliveredCount: 0,
        failedCount: 0,
        invalidTokenCount: 0,
      }
    }

    const result = await this.sender.sendToTokens(tokens, {
      body: input.body,
      data: input.data,
      title: input.title,
    })

    if (result.invalidTokens.length > 0) {
      await this.repository.deactivateTokens(result.invalidTokens)
    }

    return {
      deliveredCount: result.deliveredCount,
      failedCount: result.failedCount,
      invalidTokenCount: result.invalidTokens.length,
    }
  }
}
