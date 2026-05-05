import type { PushNotificationsService } from '../push-notifications/index.js'
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

    for (const reminder of reminders) {
      try {
        const result = await this.pushNotificationsService.sendNotification(
          {
            userId: reminder.userId,
            workspaceId: reminder.workspaceId,
          },
          {
            body: `Через 15 минут: ${reminder.taskTitle}`,
            data: {
              path: '/today',
              taskId: reminder.taskId,
              type: 'task-reminder',
            },
            title: 'Скоро задача',
          },
        )

        if (shouldRetryReminder(result)) {
          await this.repository.releaseClaim(reminder.id)
          releasedCount += 1
          continue
        }

        await this.repository.markDelivered(reminder.id)
        deliveredCount += 1
      } catch {
        await this.repository.releaseClaim(reminder.id)
        releasedCount += 1
      }
    }

    return {
      claimedCount: reminders.length,
      deliveredCount,
      releasedCount,
    }
  }
}

function shouldRetryReminder(result: {
  deliveredCount: number
  failedCount: number
  invalidTokenCount: number
}): boolean {
  return (
    result.deliveredCount === 0 &&
    result.failedCount > 0 &&
    result.invalidTokenCount === 0
  )
}
