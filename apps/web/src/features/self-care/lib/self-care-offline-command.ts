import {
  type SelfCareCompletion,
  type SelfCareDashboardResponse,
  type SelfCareHistoryResponse,
  type SelfCareItem,
  selfCareItemInputSchema,
  type SelfCareListResponse,
  type SelfCareOccurrence,
  type SelfCareOfflineCommand,
  type SelfCareOfflineCommandResult,
  type SelfCarePlanResponse,
  type SelfCareRitualStepDraftListResponse,
  type SelfCareSettingsResponse,
  type SelfCareTemplate,
  type SelfCareTodayItem,
} from '@planner/contracts'

export interface SelfCareOptimisticSource {
  actorUserId: string
  dashboard?: SelfCareDashboardResponse | undefined
  drafts?: SelfCareRitualStepDraftListResponse | undefined
  history?: SelfCareHistoryResponse | undefined
  list?: SelfCareListResponse | undefined
  occurredAt: string
  plan?: SelfCarePlanResponse | undefined
  settings?: SelfCareSettingsResponse | undefined
  templates?: SelfCareTemplate[] | undefined
  workspaceId: string
}

export class SelfCareOfflineBaseUnavailableError extends Error {
  constructor() {
    super(
      'Чтобы надёжно сохранить это изменение без сети, сначала откройте актуальные данные при подключении.',
    )
    this.name = 'SelfCareOfflineBaseUnavailableError'
  }
}

export function createOptimisticSelfCareResult(
  command: SelfCareOfflineCommand,
  source: SelfCareOptimisticSource,
): SelfCareOfflineCommandResult {
  switch (command.type) {
    case 'create_item': {
      const item = createItemFromInput(command.input, source)
      return {
        item,
        kind: 'item',
        occurrence: command.initialSchedule
          ? createOccurrence(
              item.id,
              command.initialSchedule.occurrenceId,
              command.initialSchedule.input,
              source,
            )
          : null,
      }
    }

    case 'create_item_from_template': {
      const template = source.templates?.find(
        (candidate) => candidate.id === command.templateId,
      )

      if (!template) {
        throw new SelfCareOfflineBaseUnavailableError()
      }

      const item = createItemFromInput(
        selfCareItemInputSchema.parse({
          category: template.category,
          color: template.color,
          description: template.description,
          icon: template.icon,
          id: command.itemId,
          importance: template.importance,
          steps: template.defaultSteps.map((title, order) => ({
            isOptional: false,
            order,
            title,
          })),
          title: template.title,
          type: template.type,
          ...command.overrides,
        }),
        source,
        template.id,
      )
      return {
        item,
        kind: 'item',
        occurrence: command.initialSchedule
          ? createOccurrence(
              item.id,
              command.initialSchedule.occurrenceId,
              command.initialSchedule.input,
              source,
            )
          : null,
      }
    }

    case 'update_item': {
      const current = requireItem(source, command.itemId)
      const { expectedVersion: _ignored, ...patch } = command.input
      const item: SelfCareItem = {
        ...current,
        category: patch.category ?? current.category,
        color: patch.color === undefined ? current.color : patch.color,
        customCategoryId:
          patch.customCategoryId === undefined
            ? current.customCategoryId
            : patch.customCategoryId,
        defaultDurationMinutes:
          patch.defaultDurationMinutes === undefined
            ? current.defaultDurationMinutes
            : patch.defaultDurationMinutes,
        description: patch.description ?? current.description,
        icon: patch.icon === undefined ? current.icon : patch.icon,
        importance: patch.importance ?? current.importance,
        isActive: patch.isActive ?? current.isActive,
        isArchived: patch.isArchived ?? current.isArchived,
        isPrivate: patch.isPrivate ?? current.isPrivate,
        migratedFromHabitId:
          patch.migratedFromHabitId === undefined
            ? current.migratedFromHabitId
            : patch.migratedFromHabitId,
        minimumVersionDescription:
          patch.minimumVersion === undefined
            ? current.minimumVersionDescription
            : (patch.minimumVersion?.description ?? null),
        minimumVersionDurationMinutes:
          patch.minimumVersion === undefined
            ? current.minimumVersionDurationMinutes
            : (patch.minimumVersion?.durationMinutes ?? null),
        minimumVersionTitle:
          patch.minimumVersion === undefined
            ? current.minimumVersionTitle
            : (patch.minimumVersion?.title ?? null),
        preferredTimeOfDay:
          patch.preferredTimeOfDay === undefined
            ? current.preferredTimeOfDay
            : patch.preferredTimeOfDay,
        title: patch.title ?? current.title,
        type: patch.type ?? current.type,
        updatedAt: source.occurredAt,
        version: command.expectedVersion + 1,
      }
      const scheduleResult = projectScheduleChange(
        item.id,
        command.scheduleChange,
        source,
      )

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
      const current = requireItem(source, command.itemId)
      return {
        item: {
          ...current,
          isActive: false,
          isArchived: true,
          updatedAt: source.occurredAt,
          version: command.expectedVersion + 1,
        },
        kind: 'item',
      }
    }

    case 'schedule_item': {
      if (command.existingOccurrenceId) {
        const current = requireOccurrence(source, command.existingOccurrenceId)

        return {
          kind: 'occurrence',
          occurrence: updateOccurrenceSchedule(current, command.input, source),
        }
      }

      return {
        kind: 'occurrence',
        occurrence: createOccurrence(
          command.itemId,
          command.occurrenceId!,
          command.input,
          source,
        ),
      }
    }

    case 'move_occurrence': {
      const current = requireOccurrence(source, command.occurrenceId)
      return {
        kind: 'occurrence_rescheduled',
        occurrence: moveOccurrence(current, command.input.newDate, source),
        replacement: createOccurrence(
          current.itemId,
          command.replacementOccurrenceId,
          command.replacementInput,
          source,
        ),
      }
    }

    case 'cancel_occurrence': {
      const current = requireOccurrence(source, command.occurrenceId)
      return {
        kind: 'occurrence',
        occurrence: {
          ...current,
          status: 'cancelled',
          updatedAt: source.occurredAt,
          version: command.expectedVersion + 1,
        },
      }
    }

    case 'skip_occurrence': {
      const current = requireOccurrence(source, command.occurrenceId)
      return {
        kind: 'occurrence',
        occurrence: {
          ...current,
          status: 'skipped',
          updatedAt: source.occurredAt,
          version: command.expectedVersion + 1,
        },
      }
    }

    case 'complete_occurrence': {
      const occurrence = requireOccurrence(source, command.occurrenceId)
      const item = requireItem(source, occurrence.itemId)
      const entry = findEntryForOccurrence(source, occurrence.id)
      const completion = createCompletion(
        command.completionId,
        item.id,
        occurrence,
        command.input,
        source,
      )
      return {
        completion,
        ...buildOptimisticCompletionRelations(entry, completion),
        kind: 'completion',
      }
    }

    case 'complete_item_now':
    case 'complete_flexible_goal':
    case 'complete_course_session': {
      const item = requireItem(source, command.itemId)
      const entry = findEntryForItem(source, item.id)
      const completion = createCompletion(
        command.completionId,
        item.id,
        null,
        command.input,
        source,
      )
      return {
        completion,
        ...buildOptimisticCompletionRelations(entry, completion),
        item: {
          ...item,
          updatedAt: source.occurredAt,
          version: command.expectedVersion + 1,
        },
        kind: 'completion',
      }
    }

    case 'update_completion': {
      const current = requireCompletion(source, command.completionId)
      const patch = command.input
      return {
        completion: {
          ...current,
          alternativeTitle:
            patch.alternativeTitle === undefined
              ? current.alternativeTitle
              : patch.alternativeTitle,
          completedVariant:
            patch.completedVariant === undefined
              ? current.completedVariant
              : patch.completedVariant,
          currency:
            patch.currency === undefined ? current.currency : patch.currency,
          durationMinutes:
            patch.durationMinutes === undefined
              ? current.durationMinutes
              : patch.durationMinutes,
          energyAfter:
            patch.energyAfter === undefined
              ? current.energyAfter
              : patch.energyAfter,
          energyBefore:
            patch.energyBefore === undefined
              ? current.energyBefore
              : patch.energyBefore,
          exerciseSets: patch.exerciseSets ?? current.exerciseSets,
          measurementUnit:
            patch.measurementUnit === undefined
              ? current.measurementUnit
              : patch.measurementUnit,
          measurementValue:
            patch.measurementValue === undefined
              ? current.measurementValue
              : patch.measurementValue,
          moodAfter:
            patch.moodAfter === undefined ? current.moodAfter : patch.moodAfter,
          moodBefore:
            patch.moodBefore === undefined
              ? current.moodBefore
              : patch.moodBefore,
          note: patch.note ?? current.note,
          price: patch.price === undefined ? current.price : patch.price,
          updatedAt: source.occurredAt,
          version: command.expectedVersion + 1,
        },
        kind: 'completion',
      }
    }

    case 'update_settings': {
      const current = source.settings ?? readDashboardSettings(source)

      if (!current) {
        throw new SelfCareOfflineBaseUnavailableError()
      }

      return {
        kind: 'settings',
        value: {
          ...current,
          settings: {
            ...current.settings,
            currency:
              command.input.currency === undefined
                ? current.settings.currency
                : command.input.currency,
            showAppointmentsInCalendar:
              command.input.showAppointmentsInCalendar ??
              current.settings.showAppointmentsInCalendar,
            showSelfCareInMainTasks:
              command.input.showSelfCareInMainTasks ??
              current.settings.showSelfCareInMainTasks,
            updatedAt: source.occurredAt,
            version: command.expectedVersion + 1,
          },
        },
      }
    }

    case 'upsert_ritual_step_draft': {
      const current = source.drafts

      if (!current || current.date !== command.input.date) {
        throw new SelfCareOfflineBaseUnavailableError()
      }

      const draft = {
        ...command.input,
        version: (command.expectedVersion ?? 0) + 1,
      }
      return {
        kind: 'ritual_step_drafts',
        value: {
          ...current,
          drafts: [
            ...current.drafts.filter(
              (candidate) =>
                candidate.itemId !== draft.itemId ||
                candidate.occurrenceId !== draft.occurrenceId,
            ),
            draft,
          ],
        },
      }
    }
  }
}

export function findSelfCareItem(
  source: Omit<SelfCareOptimisticSource, 'occurredAt'>,
  itemId: string,
): SelfCareItem | null {
  return (
    source.list?.items.find((item) => item.id === itemId) ??
    source.history?.items.find((item) => item.id === itemId) ??
    readAllEntries(source).find((entry) => entry.item.id === itemId)?.item ??
    null
  )
}

export function findSelfCareOccurrence(
  source: Omit<SelfCareOptimisticSource, 'occurredAt'>,
  occurrenceId: string,
): SelfCareOccurrence | null {
  return (
    readAllEntries(source).find(
      (entry) => entry.occurrence?.id === occurrenceId,
    )?.occurrence ?? null
  )
}

export function findSelfCareCompletion(
  source: Omit<SelfCareOptimisticSource, 'occurredAt'>,
  completionId: string,
): SelfCareCompletion | null {
  return (
    source.history?.completions.find(
      (completion) => completion.id === completionId,
    ) ??
    readAllEntries(source)
      .flatMap((entry) => [
        entry.completion,
        entry.lastExercise,
        entry.lastMeasurement,
      ])
      .find((completion) => completion?.id === completionId) ??
    null
  )
}

function createItemFromInput(
  input: Parameters<typeof selfCareItemInputSchema.parse>[0],
  source: SelfCareOptimisticSource,
  templateId: string | null = null,
): SelfCareItem {
  const value = selfCareItemInputSchema.parse(input)

  if (!value.id) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return {
    category: value.category,
    color: value.color,
    createdAt: source.occurredAt,
    createdFromTemplateId: templateId,
    customCategoryId: value.customCategoryId,
    defaultDurationMinutes: value.defaultDurationMinutes,
    deletedAt: null,
    description: value.description,
    icon: value.icon,
    id: value.id,
    importance: value.importance,
    isActive: value.isActive,
    isArchived: value.isArchived,
    isPrivate: value.isPrivate,
    migratedFromHabitId: value.migratedFromHabitId,
    minimumVersionDescription: value.minimumVersion?.description ?? null,
    minimumVersionDurationMinutes:
      value.minimumVersion?.durationMinutes ?? null,
    minimumVersionTitle: value.minimumVersion?.title ?? null,
    preferredTimeOfDay: value.preferredTimeOfDay,
    title: value.title,
    type: value.type,
    updatedAt: source.occurredAt,
    userId: source.actorUserId,
    version: 1,
    workspaceId: source.workspaceId,
  }
}

function createOccurrence(
  itemId: string,
  occurrenceId: string,
  input: {
    reminderOffsetsMinutes: number[]
    scheduledFor: string
    timezone: string | null
  },
  source: SelfCareOptimisticSource,
): SelfCareOccurrence {
  return {
    completedAt: null,
    createdAt: source.occurredAt,
    dueAt: null,
    generatedAt: source.occurredAt,
    id: occurrenceId,
    itemId,
    movedTo: null,
    reminderOffsetsMinutes: input.reminderOffsetsMinutes,
    reminderTimeZone: input.timezone,
    scheduledFor: input.scheduledFor,
    scheduleRuleId: null,
    status: 'scheduled',
    updatedAt: source.occurredAt,
    userId: source.actorUserId,
    version: 1,
  }
}

function moveOccurrence(
  current: SelfCareOccurrence,
  newDate: string,
  source: SelfCareOptimisticSource,
): SelfCareOccurrence {
  return {
    ...current,
    movedTo: newDate,
    status: 'moved',
    updatedAt: source.occurredAt,
    version: current.version + 1,
  }
}

function updateOccurrenceSchedule(
  current: SelfCareOccurrence,
  input: {
    reminderOffsetsMinutes: number[]
    scheduledFor: string
    timezone: string | null
  },
  source: SelfCareOptimisticSource,
): SelfCareOccurrence {
  return {
    ...current,
    reminderOffsetsMinutes: input.reminderOffsetsMinutes,
    reminderTimeZone: input.timezone,
    scheduledFor: input.scheduledFor,
    updatedAt: source.occurredAt,
    version: current.version + 1,
  }
}

function createCompletion(
  completionId: string,
  itemId: string,
  occurrence: SelfCareOccurrence | null,
  input: {
    alternativeTitle: string | null
    completedAt: string
    completedVariant: SelfCareCompletion['completedVariant']
    currency: string | null
    durationMinutes: number | null
    energyAfter: number | null
    energyBefore: number | null
    exerciseSets: SelfCareCompletion['exerciseSets']
    measurementUnit: string | null
    measurementValue: number | null
    moodAfter: number | null
    moodBefore: number | null
    note: string
    price: number | null
    status: SelfCareCompletion['status']
  },
  source: SelfCareOptimisticSource,
): SelfCareCompletion {
  return {
    alternativeTitle: input.alternativeTitle,
    completedAt: input.completedAt,
    completedVariant: input.completedVariant,
    createdAt: source.occurredAt,
    currency: input.currency,
    durationMinutes: input.durationMinutes,
    energyAfter: input.energyAfter,
    energyBefore: input.energyBefore,
    exerciseSets: input.exerciseSets,
    id: completionId,
    itemId,
    measurementUnit: input.measurementUnit,
    measurementValue: input.measurementValue,
    moodAfter: input.moodAfter,
    moodBefore: input.moodBefore,
    note: input.note,
    occurrenceId: occurrence?.id ?? null,
    price: input.price,
    scheduledFor: occurrence?.scheduledFor ?? null,
    status: input.status,
    updatedAt: source.occurredAt,
    userId: source.actorUserId,
    version: 1,
  }
}

function projectScheduleChange(
  itemId: string,
  scheduleChange: Extract<
    SelfCareOfflineCommand,
    { type: 'update_item' }
  >['scheduleChange'],
  source: SelfCareOptimisticSource,
): {
  occurrence: SelfCareOccurrence
  replacement?: SelfCareOccurrence | undefined
} | null {
  if (!scheduleChange) {
    return null
  }

  if (scheduleChange.type === 'schedule') {
    return {
      occurrence: createOccurrence(
        itemId,
        scheduleChange.occurrenceId,
        scheduleChange.input,
        source,
      ),
    }
  }

  if (scheduleChange.type === 'update_schedule') {
    const current = requireOccurrence(source, scheduleChange.occurrenceId)
    return {
      occurrence: updateOccurrenceSchedule(
        current,
        scheduleChange.input,
        source,
      ),
    }
  }

  const current = requireOccurrence(source, scheduleChange.occurrenceId)
  return {
    occurrence: moveOccurrence(current, scheduleChange.input.newDate, source),
    replacement: createOccurrence(
      itemId,
      scheduleChange.replacementOccurrenceId,
      scheduleChange.replacementInput,
      source,
    ),
  }
}

function requireItem(
  source: SelfCareOptimisticSource,
  itemId: string,
): SelfCareItem {
  const item = findSelfCareItem(source, itemId)

  if (!item) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return item
}

function requireOccurrence(
  source: SelfCareOptimisticSource,
  occurrenceId: string,
): SelfCareOccurrence {
  const occurrence = findSelfCareOccurrence(source, occurrenceId)

  if (!occurrence) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return occurrence
}

function requireCompletion(
  source: SelfCareOptimisticSource,
  completionId: string,
): SelfCareCompletion {
  const completion = findSelfCareCompletion(source, completionId)

  if (!completion) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return completion
}

function readDashboardSettings(
  source: SelfCareOptimisticSource,
): SelfCareSettingsResponse | null {
  return source.dashboard
    ? { minimumItems: [], settings: source.dashboard.settings }
    : null
}

function readAllEntries(
  source: Omit<SelfCareOptimisticSource, 'occurredAt'>,
): SelfCareTodayItem[] {
  return [
    ...(source.dashboard?.todayItems ?? []),
    ...(source.dashboard?.flexibleGoals ?? []),
    ...(source.dashboard?.overdueItems ?? []),
    ...(source.dashboard?.planningHints ?? []),
    ...(source.dashboard?.upcomingImportant ?? []),
    ...(source.plan?.courses ?? []),
    ...(source.plan?.medical ?? []),
    ...(source.plan?.occurrences ?? []),
    ...(source.plan?.planningHints ?? []),
  ]
}

function findEntryForOccurrence(
  source: Omit<SelfCareOptimisticSource, 'occurredAt'>,
  occurrenceId: string,
): SelfCareTodayItem | null {
  return (
    readAllEntries(source).find(
      (entry) => entry.occurrence?.id === occurrenceId,
    ) ?? null
  )
}

function findEntryForItem(
  source: Omit<SelfCareOptimisticSource, 'occurredAt'>,
  itemId: string,
): SelfCareTodayItem | null {
  return (
    readAllEntries(source).find((entry) => entry.item.id === itemId) ?? null
  )
}

function buildOptimisticCompletionRelations(
  entry: SelfCareTodayItem | null,
  completion: SelfCareCompletion,
): Pick<
  Extract<SelfCareOfflineCommandResult, { kind: 'completion' }>,
  'courseDetails' | 'scheduleRule'
> {
  if (!entry) {
    return {}
  }

  const isProgress =
    completion.status === 'done' ||
    completion.status === 'partial' ||
    completion.status === 'alternative_done'
  const courseDetails =
    entry.courseDetails && isProgress
      ? {
          ...entry.courseDetails,
          completedCount: Math.min(
            entry.courseDetails.totalCount,
            entry.courseDetails.completedCount + 1,
          ),
          isCompleted:
            entry.courseDetails.completedCount + 1 >=
            entry.courseDetails.totalCount,
          updatedAt: completion.updatedAt,
        }
      : entry.courseDetails

  return {
    courseDetails,
    scheduleRule: entry.scheduleRule,
  }
}
