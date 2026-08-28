import {
  classifyReminderPushDelivery,
  type PushNotificationsService,
} from '../push-notifications/index.js'
import type {
  TaskReminderProcessResult,
  TaskReminderRepository,
} from './task-reminders.model.js'

export class TaskRemindersService {
  constructor(
    private readonly repository: TaskReminderRepository,
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  async processDueReminders(limit: number): Promise<TaskReminderProcessResult> {
    const reminders = await this.repository.claimDueReminders(limit)
    let deliveredCount = 0
    let releasedCount = 0
    let undeliverableCount = 0

    for (const reminder of reminders) {
      try {
        const result = await this.pushNotificationsService.sendNotification(
          {
            userId: reminder.userId,
            workspaceId: reminder.workspaceId,
          },
          {
            body: `Через ${formatReminderOffset(reminder.remindOffsetMinutes)}: ${reminder.taskTitle}`,
            data: {
              path: '/today',
              taskId: reminder.taskId,
              type: 'task-reminder',
              workspaceId: reminder.workspaceId,
            },
            notificationTag: `task-reminder:${reminder.id}`,
            title: 'Скоро задача',
          },
        )

        const outcome = classifyReminderPushDelivery(result)

        if (outcome === 'delivered') {
          await this.repository.markDelivered(reminder.id)
          deliveredCount += 1
          continue
        }

        if (outcome === 'invalid_recipient' || outcome === 'no_recipient') {
          await this.repository.markUndeliverable(reminder.id, outcome)
          undeliverableCount += 1
          continue
        }

        if (outcome === 'retryable') {
          await this.repository.releaseClaim(
            reminder.id,
            'push_delivery_retryable',
          )
          releasedCount += 1
          continue
        }
      } catch (error) {
        await this.repository.releaseClaim(
          reminder.id,
          formatDeliveryError(error),
        )
        releasedCount += 1
      }
    }

    return {
      claimedCount: reminders.length,
      deliveredCount,
      releasedCount,
      undeliverableCount,
    }
  }
}

function formatDeliveryError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return 'Unknown reminder delivery error.'
}

function formatReminderOffset(offsetMinutes: number): string {
  return offsetMinutes === 60 ? '1 час' : `${offsetMinutes} минут`
}
