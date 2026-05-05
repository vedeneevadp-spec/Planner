import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'

import type { FirebasePushConfig } from '../../bootstrap/config.js'
import type {
  PushNotificationMessage,
  PushNotificationSender,
  PushNotificationSendResult,
} from './push-notifications.model.js'

const FIREBASE_APP_NAME = 'planner-api-push'
const INVALID_FCM_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
])
const PUSH_NOTIFICATION_CHANNEL_ID = 'chaotika-general'
const MULTICAST_BATCH_SIZE = 500

export class FirebasePushNotificationSender implements PushNotificationSender {
  private readonly messaging

  constructor(config: FirebasePushConfig) {
    const existingApp = getApps().find((app) => app.name === FIREBASE_APP_NAME)
    const app =
      existingApp ??
      initializeApp(
        {
          credential: cert({
            clientEmail: config.clientEmail,
            privateKey: config.privateKey,
            projectId: config.projectId,
          }),
          projectId: config.projectId,
        },
        FIREBASE_APP_NAME,
      )

    this.messaging = getMessaging(app)
  }

  isAvailable(): boolean {
    return true
  }

  async sendToTokens(
    tokens: readonly string[],
    message: PushNotificationMessage,
  ): Promise<PushNotificationSendResult> {
    const uniqueTokens = [...new Set(tokens)].filter(
      (token) => token.length > 0,
    )
    const invalidTokens: string[] = []
    let deliveredCount = 0
    let failedCount = 0

    for (
      let index = 0;
      index < uniqueTokens.length;
      index += MULTICAST_BATCH_SIZE
    ) {
      const batchTokens = uniqueTokens.slice(
        index,
        index + MULTICAST_BATCH_SIZE,
      )
      const response = await this.messaging.sendEachForMulticast({
        android: {
          notification: {
            channelId: PUSH_NOTIFICATION_CHANNEL_ID,
          },
          priority: 'high',
        },
        ...(message.data ? { data: message.data } : {}),
        notification: {
          body: message.body,
          title: message.title,
        },
        tokens: batchTokens,
      })

      deliveredCount += response.successCount
      failedCount += response.failureCount

      response.responses.forEach((item, itemIndex) => {
        if (!item.error) {
          return
        }

        if (INVALID_FCM_TOKEN_CODES.has(item.error.code)) {
          invalidTokens.push(batchTokens[itemIndex]!)
        }
      })
    }

    return {
      deliveredCount,
      failedCount,
      invalidTokens,
    }
  }
}

export class NoopPushNotificationSender implements PushNotificationSender {
  isAvailable(): boolean {
    return false
  }

  sendToTokens(): Promise<PushNotificationSendResult> {
    throw new Error('Firebase push notifications are not configured.')
  }
}
