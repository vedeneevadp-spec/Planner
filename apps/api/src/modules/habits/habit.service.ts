import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type { HabitReadContext, HabitWriteContext } from './habit.model.js'
import type { HabitRepository } from './habit.repository.js'

export class HabitService {
  constructor(private readonly repository: HabitRepository) {}

  listHabits(context: HabitReadContext) {
    return this.repository.listByWorkspace(context)
  }

  getToday(context: HabitReadContext, date: string) {
    return this.repository.getToday({ context, date })
  }

  getStats(context: HabitReadContext, from: string, to: string) {
    return this.repository.getStats({ context, from, to })
  }

  createHabit(
    context: HabitWriteContext,
    input: Parameters<HabitRepository['create']>[0]['input'],
  ) {
    assertCanWriteHabits(context)

    return this.repository.create({ context, input })
  }

  updateHabit(
    context: HabitWriteContext,
    habitId: string,
    input: Parameters<HabitRepository['update']>[0]['input'],
  ) {
    assertCanWriteHabits(context)

    return this.repository.update({ context, habitId, input })
  }

  removeHabit(context: HabitWriteContext, habitId: string) {
    assertCanWriteHabits(context)

    return this.repository.remove({ context, habitId })
  }

  upsertEntry(
    context: HabitWriteContext,
    habitId: string,
    date: string,
    input: Parameters<HabitRepository['upsertEntry']>[0]['input'],
  ) {
    assertCanWriteHabits(context)

    return this.repository.upsertEntry({ context, date, habitId, input })
  }

  removeEntry(
    context: HabitWriteContext,
    habitId: string,
    date: string,
    expectedVersion?: number,
  ) {
    assertCanWriteHabits(context)

    return this.repository.removeEntry({
      context,
      date,
      expectedVersion,
      habitId,
    })
  }
}

function assertCanWriteHabits(context: HabitWriteContext): void {
  if (!canWriteWorkspaceContent(context)) {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace access cannot write habits.',
    )
  }
}
