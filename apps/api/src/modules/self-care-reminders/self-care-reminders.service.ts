import type { PushNotificationsService } from '../push-notifications/index.js'
import type {
  DueSelfCareReminder,
  SelfCareReminderProcessResult,
  SelfCareReminderRepository,
} from './self-care-reminders.model.js'

export class SelfCareRemindersService {
  constructor(
    private readonly repository: SelfCareReminderRepository,
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  async processDueReminders(
    limit: number,
  ): Promise<SelfCareReminderProcessResult> {
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
            body: buildSelfCareReminderBody(reminder),
            data: {
              occurrenceId: reminder.occurrenceId,
              path: '/self-care',
              selfCareItemId: reminder.itemId,
              type: 'self-care-reminder',
            },
            title: 'Забота о себе',
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

function buildSelfCareReminderBody(reminder: DueSelfCareReminder): string {
  if (reminder.remindOffsetMinutes === 0) {
    return `Сейчас: ${reminder.itemTitle}`
  }

  return `Через ${formatReminderOffset(reminder.remindOffsetMinutes)}: ${reminder.itemTitle}`
}

function formatReminderOffset(offsetMinutes: number): string {
  if (offsetMinutes < 60) {
    return `${offsetMinutes} ${pluralRu(offsetMinutes, 'минуту', 'минуты', 'минут')}`
  }

  if (offsetMinutes < 1440) {
    const hours = Math.round(offsetMinutes / 60)
    return `${hours} ${pluralRu(hours, 'час', 'часа', 'часов')}`
  }

  const days = Math.round(offsetMinutes / 1440)
  return `${days} ${pluralRu(days, 'день', 'дня', 'дней')}`
}

function pluralRu(
  value: number,
  one: string,
  few: string,
  many: string,
): string {
  const absolute = Math.abs(value)
  const mod10 = absolute % 10
  const mod100 = absolute % 100

  if (mod10 === 1 && mod100 !== 11) {
    return one
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }

  return many
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
