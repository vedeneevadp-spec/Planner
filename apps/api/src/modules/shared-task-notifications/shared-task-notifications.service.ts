import {
  classifyReminderPushDelivery,
  type PushNotificationsService,
} from '../push-notifications/index.js'
import type {
  ClaimedSharedTaskNotification,
  SharedTaskNotificationsProcessResult,
  SharedTaskNotificationsRepository,
} from './shared-task-notifications.model.js'

export class SharedTaskNotificationsService {
  constructor(
    private readonly repository: SharedTaskNotificationsRepository,
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  async processPendingNotifications(
    limit: number,
  ): Promise<SharedTaskNotificationsProcessResult> {
    const notifications = await this.repository.claimPendingNotifications(limit)
    let deliveredCount = 0
    let releasedCount = 0
    let undeliverableCount = 0

    for (const notification of notifications) {
      try {
        const result = await this.pushNotificationsService.sendNotification(
          {
            userId: notification.recipientUserId,
            workspaceId: notification.workspaceId,
          },
          buildPushMessage(notification),
        )
        const outcome = classifyReminderPushDelivery(result)

        if (outcome === 'delivered') {
          await this.repository.markDelivered(notification.id)
          deliveredCount += 1
          continue
        }

        if (outcome === 'invalid_recipient' || outcome === 'no_recipient') {
          await this.repository.markUndeliverable(notification.id, outcome)
          undeliverableCount += 1
          continue
        }

        await this.repository.releaseClaim(
          notification.id,
          'push_delivery_retryable',
        )
        releasedCount += 1
      } catch (error) {
        await this.repository.releaseClaim(
          notification.id,
          formatDeliveryError(error),
        )
        releasedCount += 1
      }
    }

    return {
      claimedCount: notifications.length,
      deliveredCount,
      releasedCount,
      undeliverableCount,
    }
  }
}

function buildPushMessage(notification: ClaimedSharedTaskNotification) {
  const common = {
    data: {
      notificationId: notification.id,
      path: '/today',
      taskId: notification.taskId,
      type: toPushNotificationType(notification.kind),
      workspaceId: notification.workspaceId,
    },
    notificationTag: `shared-task-notification:${notification.id}`,
  }

  if (notification.kind === 'shared_task_assigned') {
    return {
      ...common,
      body: `${notification.taskTitle} · ${notification.workspaceName}`,
      title: 'Вам назначена задача',
    }
  }

  if (notification.kind === 'shared_task_ready_for_review') {
    return {
      ...common,
      body: `${notification.taskTitle} · ${notification.workspaceName}`,
      title: 'Задача готова к проверке',
    }
  }

  const actorPrefix = notification.actorDisplayName
    ? `${notification.actorDisplayName}: `
    : ''

  return {
    ...common,
    body: `${actorPrefix}${notification.taskTitle}`,
    title: `Новая задача в «${notification.workspaceName}»`,
  }
}

function toPushNotificationType(
  kind: ClaimedSharedTaskNotification['kind'],
): string {
  if (kind === 'shared_task_created') {
    return 'shared-task-created'
  }

  if (kind === 'shared_task_assigned') {
    return 'shared-task-assigned'
  }

  return 'shared-task-ready-for-review'
}

function formatDeliveryError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return 'Unknown shared task notification delivery error.'
}
