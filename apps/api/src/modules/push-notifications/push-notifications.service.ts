import { HttpError } from '../../bootstrap/http-error.js'
import type {
  PushDeviceUpsertInput,
  PushNotificationMessage,
  PushNotificationRecipient,
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

  isAvailable(): boolean {
    return this.sender.isAvailable()
  }

  async sendNotification(
    recipient: PushNotificationRecipient | PushNotificationSession,
    message: PushNotificationMessage,
  ): Promise<PushTestNotificationResponse> {
    if (!this.sender.isAvailable()) {
      throw new HttpError(
        503,
        'push_notifications_not_configured',
        'Firebase push notifications are not configured on the server.',
      )
    }

    const devices = await this.repository.listActiveDevices(recipient)
    const actionableTokens: string[] = []
    const legacyTokens: string[] = []

    for (const device of devices) {
      const target =
        message.data?.type === 'task-reminder' &&
        device.platform === 'android' &&
        supportsTaskNotificationActions(device.appVersion)
          ? actionableTokens
          : legacyTokens
      target.push(device.token)
    }

    if (devices.length === 0) {
      return {
        deliveredCount: 0,
        failedCount: 0,
        invalidTokenCount: 0,
      }
    }

    // Older APKs rely on Firebase's system-tray rendering. Only versions
    // shipping the native receiver may receive data-only task reminders.
    const groups = [
      { tokens: legacyTokens, message },
      {
        tokens: actionableTokens,
        message: {
          ...message,
          androidDataOnly: true,
          data: {
            ...message.data,
            actionsVersion: '1',
            recipientUserId:
              'actorUserId' in recipient
                ? recipient.actorUserId
                : recipient.userId,
          },
        },
      },
    ]
    const result = {
      deliveredCount: 0,
      failedCount: 0,
      invalidTokens: [] as string[],
    }
    for (const group of groups) {
      if (group.tokens.length === 0) continue
      try {
        const sent = await this.sender.sendToTokens(group.tokens, group.message)
        result.deliveredCount += sent.deliveredCount
        result.failedCount += sent.failedCount
        result.invalidTokens.push(...sent.invalidTokens)
      } catch {
        result.failedCount += group.tokens.length
      }
    }

    if (result.invalidTokens.length > 0) {
      await this.repository.deactivateTokens(result.invalidTokens, recipient)
    }

    return {
      deliveredCount: result.deliveredCount,
      failedCount: result.failedCount,
      invalidTokenCount: result.invalidTokens.length,
    }
  }

  async sendTestNotification(
    session: PushNotificationSession,
    input: PushTestNotificationInput,
  ): Promise<PushTestNotificationResponse> {
    return this.sendNotification(session, {
      body: input.body,
      data: input.data,
      title: input.title,
    })
  }
}

function supportsTaskNotificationActions(version: string | null): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  return (
    major! > 1 || (major === 1 && (minor! > 1 || (minor === 1 && patch! >= 27)))
  )
}
