import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CreateHabitCommand,
  DeleteHabitCommand,
  DeleteHabitEntryCommand,
  GetHabitStatsCommand,
  GetHabitTodayCommand,
  HabitReadContext,
  HabitStatsResult,
  HabitTodayResult,
  StoredHabitEntryRecord,
  StoredHabitRecord,
  UpdateHabitCommand,
  UpsertHabitEntryCommand,
} from './habit.model.js'
import type { HabitRepository } from './habit.repository.js'
import {
  buildHabitStats,
  createStoredHabitEntryRecord,
  createStoredHabitRecord,
  getDefaultEntryValue,
  getEntryProgressPercent,
  isHabitScheduledOnDate,
  normalizeDaysOfWeek,
  sortStoredHabits,
} from './habit.shared.js'

export class MemoryHabitRepository implements HabitRepository {
  private readonly entries = new Map<string, StoredHabitEntryRecord>()
  private readonly habits = new Map<string, StoredHabitRecord>()

  listByWorkspace(context: HabitReadContext): Promise<StoredHabitRecord[]> {
    return Promise.resolve(this.listWorkspaceHabits(context))
  }

  create(command: CreateHabitCommand): Promise<StoredHabitRecord> {
    const existingHabit = command.input.id
      ? this.habits.get(command.input.id)
      : undefined

    if (
      existingHabit &&
      existingHabit.workspaceId === command.context.workspaceId &&
      existingHabit.deletedAt === null
    ) {
      return Promise.resolve(existingHabit)
    }

    const habit = createStoredHabitRecord(command.input, {
      actorUserId: command.context.actorUserId,
      sortOrder:
        command.input.sortOrder ??
        this.listWorkspaceHabits(command.context).length,
      workspaceId: command.context.workspaceId,
    })

    this.habits.set(habit.id, habit)

    return Promise.resolve(habit)
  }

  update(command: UpdateHabitCommand): Promise<StoredHabitRecord> {
    const habit = this.getHabitOrThrow(
      command.context.workspaceId,
      command.habitId,
    )

    if (
      command.input.expectedVersion !== undefined &&
      command.input.expectedVersion !== habit.version
    ) {
      throw new HttpError(
        409,
        'habit_version_conflict',
        'Habit was changed on the server.',
        {
          actualVersion: habit.version,
          expectedVersion: command.input.expectedVersion,
        },
      )
    }

    const nextHabit: StoredHabitRecord = {
      ...habit,
      ...(command.input.title !== undefined
        ? { title: command.input.title.trim() }
        : {}),
      ...(command.input.description !== undefined
        ? { description: command.input.description.trim() }
        : {}),
      ...(command.input.color !== undefined
        ? { color: command.input.color.trim() }
        : {}),
      ...(command.input.icon !== undefined
        ? { icon: command.input.icon.trim() }
        : {}),
      ...(command.input.frequency !== undefined
        ? { frequency: command.input.frequency }
        : {}),
      ...(command.input.daysOfWeek !== undefined
        ? { daysOfWeek: normalizeDaysOfWeek(command.input.daysOfWeek) }
        : {}),
      ...(command.input.targetType !== undefined
        ? { targetType: command.input.targetType }
        : {}),
      ...(command.input.targetValue !== undefined
        ? { targetValue: command.input.targetValue }
        : {}),
      ...(command.input.unit !== undefined
        ? { unit: command.input.unit.trim() }
        : {}),
      ...(command.input.reminderTime !== undefined
        ? { reminderTime: command.input.reminderTime }
        : {}),
      ...(command.input.startDate !== undefined
        ? { startDate: command.input.startDate }
        : {}),
      ...(command.input.endDate !== undefined
        ? { endDate: command.input.endDate }
        : {}),
      ...(command.input.sphereId !== undefined
        ? { sphereId: command.input.sphereId }
        : {}),
      ...(command.input.isActive !== undefined
        ? { isActive: command.input.isActive }
        : {}),
      ...(command.input.sortOrder !== undefined
        ? { sortOrder: command.input.sortOrder }
        : {}),
      updatedAt: new Date().toISOString(),
      version: habit.version + 1,
    }

    this.habits.set(nextHabit.id, nextHabit)

    return Promise.resolve(nextHabit)
  }

  remove(command: DeleteHabitCommand): Promise<void> {
    const habit = this.getHabitOrThrow(
      command.context.workspaceId,
      command.habitId,
    )
    const deletedAt = new Date().toISOString()

    this.habits.set(habit.id, {
      ...habit,
      deletedAt,
      isActive: false,
      updatedAt: deletedAt,
      version: habit.version + 1,
    })

    for (const entry of this.entries.values()) {
      if (
        entry.workspaceId === command.context.workspaceId &&
        entry.habitId === command.habitId &&
        entry.deletedAt === null
      ) {
        this.entries.set(entry.id, {
          ...entry,
          deletedAt,
          updatedAt: deletedAt,
          version: entry.version + 1,
        })
      }
    }

    return Promise.resolve()
  }

  upsertEntry(
    command: UpsertHabitEntryCommand,
  ): Promise<StoredHabitEntryRecord> {
    const habit = this.getHabitOrThrow(
      command.context.workspaceId,
      command.habitId,
    )

    assertHabitScheduled(habit, command.date)

    const existingEntry = this.findActiveEntry(
      command.context.workspaceId,
      command.habitId,
      command.date,
    )

    if (
      existingEntry &&
      command.input.expectedVersion !== undefined &&
      existingEntry.version !== command.input.expectedVersion
    ) {
      throw new HttpError(
        409,
        'habit_entry_version_conflict',
        'Habit entry was changed on the server.',
        {
          actualVersion: existingEntry.version,
          expectedVersion: command.input.expectedVersion,
        },
      )
    }

    if (!existingEntry && command.input.expectedVersion !== undefined) {
      throw new HttpError(
        409,
        'habit_entry_version_conflict',
        'Habit entry was changed on the server.',
        {
          actualVersion: null,
          expectedVersion: command.input.expectedVersion,
        },
      )
    }

    if (existingEntry) {
      const updatedAt = new Date().toISOString()
      const nextEntry: StoredHabitEntryRecord = {
        ...existingEntry,
        note: command.input.note,
        status: command.input.status,
        updatedAt,
        value: getDefaultEntryValue(habit, command.input.value),
        version: existingEntry.version + 1,
      }

      this.entries.set(nextEntry.id, nextEntry)

      return Promise.resolve(nextEntry)
    }

    const entry = createStoredHabitEntryRecord(
      {
        date: command.date,
        habit,
        note: command.input.note,
        status: command.input.status,
        value: getDefaultEntryValue(habit, command.input.value),
      },
      {
        actorUserId: command.context.actorUserId,
        workspaceId: command.context.workspaceId,
      },
    )

    this.entries.set(entry.id, entry)

    return Promise.resolve(entry)
  }

  removeEntry(command: DeleteHabitEntryCommand): Promise<void> {
    const entry = this.findActiveEntry(
      command.context.workspaceId,
      command.habitId,
      command.date,
    )

    if (!entry) {
      return Promise.resolve()
    }

    if (
      command.expectedVersion !== undefined &&
      command.expectedVersion !== entry.version
    ) {
      throw new HttpError(
        409,
        'habit_entry_version_conflict',
        'Habit entry was changed on the server.',
        {
          actualVersion: entry.version,
          expectedVersion: command.expectedVersion,
        },
      )
    }

    const deletedAt = new Date().toISOString()

    this.entries.set(entry.id, {
      ...entry,
      deletedAt,
      updatedAt: deletedAt,
      version: entry.version + 1,
    })

    return Promise.resolve()
  }

  getToday(command: GetHabitTodayCommand): Promise<HabitTodayResult> {
    const habits = this.listWorkspaceHabits(command.context).filter((habit) =>
      isHabitScheduledOnDate(habit, command.date),
    )
    const entries = this.listWorkspaceEntries(command.context.workspaceId)
    const items = habits.map((habit) => {
      const habitEntries = entries.filter((entry) => entry.habitId === habit.id)
      const entry =
        habitEntries.find((item) => item.date === command.date) ?? null
      const stats = buildHabitStats(habit, habitEntries, {
        from: habit.startDate,
        to: command.date,
      })

      return {
        entry,
        habit,
        isDueToday: true,
        progressPercent: getEntryProgressPercent(habit, entry),
        stats,
      }
    })

    return Promise.resolve({
      date: command.date,
      items,
    })
  }

  getStats(command: GetHabitStatsCommand): Promise<HabitStatsResult> {
    const habits = this.listWorkspaceHabits(command.context)
    const entries = this.listWorkspaceEntries(command.context.workspaceId)

    return Promise.resolve({
      from: command.from,
      habits,
      stats: habits.map((habit) =>
        buildHabitStats(
          habit,
          entries.filter((entry) => entry.habitId === habit.id),
          {
            from: command.from,
            to: command.to,
          },
        ),
      ),
      to: command.to,
    })
  }

  private listWorkspaceHabits(
    context: Pick<HabitReadContext, 'workspaceId'>,
  ): StoredHabitRecord[] {
    return sortStoredHabits(
      [...this.habits.values()].filter(
        (habit) =>
          habit.workspaceId === context.workspaceId && habit.deletedAt === null,
      ),
    )
  }

  private listWorkspaceEntries(workspaceId: string): StoredHabitEntryRecord[] {
    return [...this.entries.values()].filter(
      (entry) => entry.workspaceId === workspaceId && entry.deletedAt === null,
    )
  }

  private getHabitOrThrow(
    workspaceId: string,
    habitId: string,
  ): StoredHabitRecord {
    const habit = this.habits.get(habitId)

    if (!habit || habit.workspaceId !== workspaceId || habit.deletedAt) {
      throw new HttpError(404, 'habit_not_found', 'Habit not found.')
    }

    return habit
  }

  private findActiveEntry(
    workspaceId: string,
    habitId: string,
    date: string,
  ): StoredHabitEntryRecord | null {
    return (
      [...this.entries.values()].find(
        (entry) =>
          entry.workspaceId === workspaceId &&
          entry.habitId === habitId &&
          entry.date === date &&
          entry.deletedAt === null,
      ) ?? null
    )
  }
}

function assertHabitScheduled(habit: StoredHabitRecord, date: string): void {
  if (!isHabitScheduledOnDate(habit, date)) {
    throw new HttpError(
      400,
      'habit_not_scheduled',
      'Habit is not scheduled for this date.',
    )
  }
}
