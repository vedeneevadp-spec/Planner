import { createHash } from 'node:crypto'

import {
  type SelfCareItem,
  type SelfCareItemScheduleInput,
  type SelfCareOfflineCommand,
  type SelfCareOfflineCommandRequest,
  type SelfCareOfflineCommandResult,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { SelfCareWriteContext } from './self-care.model.js'
import type { SelfCareRepository } from './self-care.repository.js'

export function fingerprintSelfCareCommandRequest(
  request: Pick<SelfCareOfflineCommandRequest, 'clientTimeZone' | 'command'>,
): string {
  const value = {
    ...(request.clientTimeZone
      ? { clientTimeZone: request.clientTimeZone }
      : {}),
    command: request.command,
  }

  return createHash('sha256')
    .update(JSON.stringify(sortJsonValue(value)))
    .digest('hex')
}

export async function dispatchSelfCareOfflineCommand(
  repository: SelfCareRepository,
  context: SelfCareWriteContext,
  command: SelfCareOfflineCommand,
): Promise<SelfCareOfflineCommandResult> {
  switch (command.type) {
    case 'create_item': {
      const item = await repository.createItem({
        context,
        input: command.input,
      })
      const occurrence = command.initialSchedule
        ? await repository.scheduleItem({
            context,
            input: command.initialSchedule.input,
            itemId: item.id,
            occurrenceId: command.initialSchedule.occurrenceId,
            strictInsert: true,
          })
        : null
      return { item, kind: 'item', occurrence }
    }
    case 'create_item_from_template': {
      const item = await repository.createItemFromTemplate({
        context,
        input: { overrides: { ...command.overrides, id: command.itemId } },
        templateId: command.templateId,
      })
      const occurrence = command.initialSchedule
        ? await repository.scheduleItem({
            context,
            input: command.initialSchedule.input,
            itemId: item.id,
            occurrenceId: command.initialSchedule.occurrenceId,
            strictInsert: true,
          })
        : null
      return { item, kind: 'item', occurrence }
    }
    case 'update_item': {
      const item = await repository.updateItem({
        context,
        input: { ...command.input, expectedVersion: command.expectedVersion },
        itemId: command.itemId,
      })
      const scheduleResult = command.scheduleChange
        ? await applyScheduleChange(
            repository,
            context,
            item,
            command.scheduleChange,
          )
        : null
      return {
        item,
        kind: 'item',
        occurrence: scheduleResult?.occurrence ?? null,
        ...(scheduleResult?.replacement
          ? { replacement: scheduleResult.replacement }
          : {}),
      }
    }
    case 'archive_item': {
      const item = await repository.archiveItem({
        context,
        expectedVersion: command.expectedVersion,
        itemId: command.itemId,
      })
      return { item, kind: 'item' }
    }
    case 'schedule_item': {
      const occurrence = await repository.scheduleItem({
        context,
        existingOccurrenceId: command.existingOccurrenceId,
        expectedOccurrenceVersion: command.expectedOccurrenceVersion,
        expectedVersion: command.expectedVersion,
        input: command.input,
        itemId: command.itemId,
        occurrenceId: command.occurrenceId,
        strictInsert: command.existingOccurrenceId === undefined,
      })
      return { kind: 'occurrence', occurrence }
    }
    case 'move_occurrence': {
      const occurrence = await repository.moveOccurrence({
        actedAt: command.actedAt,
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
        occurrenceId: command.occurrenceId,
      })
      const replacement = await repository.scheduleItem({
        context,
        input: assertReplacementScheduleDate(
          command.input.newDate,
          command.replacementInput,
        ),
        itemId: occurrence.itemId,
        occurrenceId: command.replacementOccurrenceId,
        strictInsert: true,
      })
      return { kind: 'occurrence_rescheduled', occurrence, replacement }
    }
    case 'cancel_occurrence': {
      const occurrence = await repository.cancelOccurrence({
        actedAt: command.actedAt,
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        occurrenceId: command.occurrenceId,
      })
      return { kind: 'occurrence', occurrence }
    }
    case 'skip_occurrence': {
      const occurrence = await repository.skipOccurrence({
        actedAt: command.actedAt,
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
        occurrenceId: command.occurrenceId,
      })
      return { kind: 'occurrence', occurrence }
    }
    case 'complete_occurrence': {
      const completion = await repository.completeOccurrence({
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
        occurrenceId: command.occurrenceId,
      })
      const aggregate = await findItemAggregate(
        repository,
        context,
        completion.itemId,
      )
      return { completion, kind: 'completion', ...aggregate }
    }
    case 'complete_item_now': {
      const completion = await repository.completeItemNow({
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
        itemId: command.itemId,
      })
      const aggregate = await findItemAggregate(
        repository,
        context,
        command.itemId,
      )
      return { completion, kind: 'completion', ...aggregate }
    }
    case 'complete_flexible_goal': {
      const completion = await repository.completeFlexibleGoal({
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
        itemId: command.itemId,
      })
      const aggregate = await findItemAggregate(
        repository,
        context,
        command.itemId,
      )
      return { completion, kind: 'completion', ...aggregate }
    }
    case 'complete_course_session': {
      const completion = await repository.completeCourseSession({
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
        itemId: command.itemId,
      })
      const aggregate = await findItemAggregate(
        repository,
        context,
        command.itemId,
      )
      return { completion, kind: 'completion', ...aggregate }
    }
    case 'update_completion': {
      const completion = await repository.updateCompletion({
        completionId: command.completionId,
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
      })
      return { completion, kind: 'completion' }
    }
    case 'update_settings': {
      const value = await repository.updateSettings({
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
      })
      return { kind: 'settings', value }
    }
    case 'upsert_ritual_step_draft': {
      const value = await repository.upsertRitualStepDraft({
        context,
        expectedVersion: command.expectedVersion,
        input: command.input,
      })
      return { kind: 'ritual_step_drafts', value }
    }
  }
}

async function applyScheduleChange(
  repository: SelfCareRepository,
  context: SelfCareWriteContext,
  item: SelfCareItem,
  change: Extract<
    Extract<SelfCareOfflineCommand, { type: 'update_item' }>['scheduleChange'],
    object
  >,
) {
  if (change.type === 'schedule') {
    return {
      occurrence: await repository.scheduleItem({
        context,
        input: change.input,
        itemId: item.id,
        occurrenceId: change.occurrenceId,
        strictInsert: true,
      }),
    }
  }

  if (change.type === 'update_schedule') {
    return {
      occurrence: await repository.scheduleItem({
        context,
        existingOccurrenceId: change.occurrenceId,
        expectedOccurrenceVersion: change.expectedVersion,
        expectedVersion: item.version,
        input: change.input,
        itemId: item.id,
        strictInsert: false,
      }),
    }
  }

  const occurrence = await repository.moveOccurrence({
    actedAt: change.actedAt,
    completionId: change.completionId,
    context,
    expectedItemId: item.id,
    expectedVersion: change.expectedVersion,
    input: change.input,
    occurrenceId: change.occurrenceId,
  })

  if (occurrence.itemId !== item.id) {
    throw new HttpError(
      409,
      'self_care_reschedule_item_conflict',
      'The occurrence selected for rescheduling belongs to another self-care item.',
      {
        actualItemId: occurrence.itemId,
        expectedItemId: item.id,
        occurrenceId: occurrence.id,
      },
    )
  }

  const replacement = await repository.scheduleItem({
    context,
    input: assertReplacementScheduleDate(
      change.input.newDate,
      change.replacementInput,
    ),
    itemId: occurrence.itemId,
    occurrenceId: change.replacementOccurrenceId,
    strictInsert: true,
  })

  return { occurrence, replacement }
}

function assertReplacementScheduleDate(
  movedTo: string,
  input: SelfCareItemScheduleInput,
): SelfCareItemScheduleInput {
  if (input.scheduledFor !== movedTo) {
    throw new HttpError(
      400,
      'self_care_reschedule_date_mismatch',
      'Replacement schedule date must match the moved-to date.',
    )
  }

  return input
}

async function findItemAggregate(
  repository: SelfCareRepository,
  context: SelfCareWriteContext,
  itemId: string,
): Promise<{
  courseDetails:
    | Awaited<
        ReturnType<SelfCareRepository['listItems']>
      >['courseDetails'][number]
    | null
  item: SelfCareItem
  scheduleRule:
    | Awaited<
        ReturnType<SelfCareRepository['listItems']>
      >['scheduleRules'][number]
    | null
}> {
  const result = await repository.listItems(context, { includeArchived: true })
  const item = result.items.find((candidate) => candidate.id === itemId)

  if (!item) {
    throw new Error('Self-care command result item disappeared.')
  }

  return {
    courseDetails:
      result.courseDetails.find((candidate) => candidate.itemId === itemId) ??
      null,
    item,
    scheduleRule:
      result.scheduleRules.find((candidate) => candidate.itemId === itemId) ??
      null,
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry))
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  )
}
