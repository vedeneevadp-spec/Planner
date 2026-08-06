import type {
  SelfCareAnalyticsResponse,
  SelfCareCompletion,
  SelfCareDashboardResponse,
  SelfCareHistoryResponse,
  SelfCareItem,
  SelfCareListResponse,
  SelfCareOccurrence,
  SelfCareOfflineCommand,
  SelfCareOfflineCommandResult,
  SelfCarePlanResponse,
  SelfCareRitualStepDraftListResponse,
  SelfCareSettingsResponse,
  SelfCareTodayItem,
} from '@planner/contracts'

import type { SelfCareOfflineOverlay } from './offline-self-care-store'

export type ProjectableSelfCareScope =
  | 'analytics'
  | 'dashboard'
  | 'history'
  | 'items'
  | 'plan'
  | 'ritual-step-drafts'
  | 'settings'

export function projectSelfCareCachedRead(
  scope: string,
  cacheKey: string,
  data: unknown,
  overlay: SelfCareOfflineOverlay,
): unknown {
  const parameters = readCacheParameters(scope, cacheKey)

  return projectSelfCareRead(scope, parameters, data, overlay)
}

export function projectSelfCareRead(
  scope: string,
  parameters: readonly string[],
  data: unknown,
  overlay: SelfCareOfflineOverlay,
): unknown {
  switch (scope) {
    case 'items':
      return projectList(data as SelfCareListResponse, overlay)
    case 'dashboard':
      return projectDashboard(data as SelfCareDashboardResponse, overlay)
    case 'plan':
      return projectPlan(data as SelfCarePlanResponse, overlay)
    case 'history':
      return projectHistory(
        data as SelfCareHistoryResponse,
        parameters,
        overlay,
      )
    case 'analytics':
      return projectAnalytics(
        data as SelfCareAnalyticsResponse,
        parameters,
        overlay,
      )
    case 'settings':
      return projectSettings(data as SelfCareSettingsResponse, overlay)
    case 'ritual-step-drafts':
      return projectDrafts(data as SelfCareRitualStepDraftListResponse, overlay)
    default:
      return data
  }
}

export function getSelfCareCommandEntityKeys(
  command: SelfCareOfflineCommand,
): string[] {
  const keys: string[] = []
  const add = (kind: string, id: string | null | undefined) => {
    if (id) {
      keys.push(`${kind}:${id}`)
    }
  }

  switch (command.type) {
    case 'create_item':
      add('item', command.input.id)
      add('occurrence', command.initialSchedule?.occurrenceId)
      break
    case 'create_item_from_template':
      add('item', command.itemId)
      add('template', command.templateId)
      add('occurrence', command.initialSchedule?.occurrenceId)
      break
    case 'update_item':
      add('item', command.itemId)
      if (command.scheduleChange?.type === 'schedule') {
        add('occurrence', command.scheduleChange.occurrenceId)
      } else if (command.scheduleChange?.type === 'update_schedule') {
        add('occurrence', command.scheduleChange.occurrenceId)
      } else if (command.scheduleChange?.type === 'reschedule') {
        add('occurrence', command.scheduleChange.occurrenceId)
        add('occurrence', command.scheduleChange.replacementOccurrenceId)
      }
      break
    case 'archive_item':
      add('item', command.itemId)
      break
    case 'schedule_item':
      add('item', command.itemId)
      add('occurrence', command.existingOccurrenceId ?? command.occurrenceId)
      break
    case 'move_occurrence':
      add('occurrence', command.occurrenceId)
      add('occurrence', command.replacementOccurrenceId)
      break
    case 'cancel_occurrence':
    case 'skip_occurrence':
    case 'complete_occurrence':
      add('occurrence', command.occurrenceId)
      add('completion', command.completionId)
      break
    case 'complete_item_now':
    case 'complete_flexible_goal':
    case 'complete_course_session':
      add('item', command.itemId)
      add('completion', command.completionId)
      break
    case 'update_completion':
      add('completion', command.completionId)
      break
    case 'update_settings':
      keys.push('settings:self')
      break
    case 'upsert_ritual_step_draft':
      keys.push(
        `draft:${command.input.date}:${command.input.itemId}:${command.input.occurrenceId ?? ''}`,
      )
      break
  }

  return [...new Set(keys)]
}

export function getSelfCareResultEntityKeys(
  result: SelfCareOfflineCommandResult,
): string[] {
  const keys: string[] = []
  const add = (kind: string, id: string | null | undefined) => {
    if (id) {
      keys.push(`${kind}:${id}`)
    }
  }

  switch (result.kind) {
    case 'item':
      add('item', result.item.id)
      add('occurrence', result.occurrence?.id)
      add('occurrence', result.replacement?.id)
      break
    case 'occurrence':
      add('item', result.occurrence.itemId)
      add('occurrence', result.occurrence.id)
      break
    case 'occurrence_rescheduled':
      add('item', result.occurrence.itemId)
      add('occurrence', result.occurrence.id)
      add('occurrence', result.replacement.id)
      break
    case 'completion':
      add('item', result.completion.itemId)
      add('occurrence', result.completion.occurrenceId)
      add('completion', result.completion.id)
      break
    case 'settings':
      keys.push('settings:self')
      break
    case 'ritual_step_drafts':
      for (const draft of result.value.drafts) {
        keys.push(
          `draft:${draft.date}:${draft.itemId}:${draft.occurrenceId ?? ''}`,
        )
      }
      break
  }

  return [...new Set(keys)]
}

function projectList(
  current: SelfCareListResponse,
  overlay: SelfCareOfflineOverlay,
): SelfCareListResponse {
  const item = readResultItem(overlay)

  if (!item) {
    return current
  }

  const isRemoved = item.isArchived || Boolean(item.deletedAt)
  const next: SelfCareListResponse = {
    ...current,
    items: isRemoved
      ? current.items.filter((candidate) => candidate.id !== item.id)
      : upsertById(current.items, item),
  }

  if (isRemoved) {
    return removeItemRelations(next, item.id)
  }

  return projectItemRelations(next, item, overlay.command)
}

function projectDashboard(
  current: SelfCareDashboardResponse,
  overlay: SelfCareOfflineOverlay,
): SelfCareDashboardResponse {
  if (overlay.result.kind === 'settings') {
    return { ...current, settings: overlay.result.value.settings }
  }

  let next: SelfCareDashboardResponse = {
    ...current,
    flexibleGoals: projectEntryList(current.flexibleGoals, overlay, (value) =>
      isOccurrenceOnDate(value, current.date),
    ),
    overdueItems: projectEntryList(current.overdueItems, overlay, (value) =>
      isOccurrenceBeforeDate(value, current.date),
    ),
    planningHints: projectEntryList(
      current.planningHints,
      overlay,
      () => false,
    ),
    todayItems: projectEntryList(current.todayItems, overlay, (value) =>
      isOccurrenceOnDate(value, current.date),
    ),
    upcomingImportant: projectEntryList(
      current.upcomingImportant,
      overlay,
      (value) => value.scheduledFor >= current.date,
    ),
  }
  const item = readResultItem(overlay)

  if (item?.type === 'flexible_goal' && !item.isArchived && !item.deletedAt) {
    next = {
      ...next,
      flexibleGoals: ensureItemEntry(next.flexibleGoals, item, overlay.command),
    }
  }

  return next
}

function projectPlan(
  current: SelfCarePlanResponse,
  overlay: SelfCareOfflineOverlay,
): SelfCarePlanResponse {
  const isInPlan = (value: SelfCareOccurrence) =>
    value.scheduledFor >= current.from && value.scheduledFor <= current.to
  let next: SelfCarePlanResponse = {
    ...current,
    courses: projectEntryList(current.courses, overlay, () => false),
    medical: projectEntryList(current.medical, overlay, isInPlan),
    occurrences: projectEntryList(current.occurrences, overlay, isInPlan),
    planningHints: projectEntryList(
      current.planningHints,
      overlay,
      () => false,
    ),
  }
  const item = readResultItem(overlay)

  if (item?.type === 'course' && !item.isArchived && !item.deletedAt) {
    next = {
      ...next,
      courses: ensureItemEntry(next.courses, item, overlay.command),
    }
  }

  return next
}

function projectHistory(
  current: SelfCareHistoryResponse,
  parameters: readonly string[],
  overlay: SelfCareOfflineOverlay,
): SelfCareHistoryResponse {
  const item = readResultItem(overlay)
  const completion = readResultCompletion(overlay)
  let next = current

  if (item) {
    next = {
      ...next,
      items:
        item.isArchived || item.deletedAt
          ? next.items.filter((candidate) => candidate.id !== item.id)
          : upsertById(next.items, item),
    }
  }

  if (completion && isDateInRange(completion.completedAt, parameters)) {
    next = {
      ...next,
      completions: upsertById(next.completions, completion).sort(
        (left, right) => right.completedAt.localeCompare(left.completedAt),
      ),
    }
  }

  return next
}

function projectAnalytics(
  current: SelfCareAnalyticsResponse,
  parameters: readonly string[],
  overlay: SelfCareOfflineOverlay,
): SelfCareAnalyticsResponse {
  const item = readResultItem(overlay)
  const completion = readResultCompletion(overlay)
  let next: SelfCareAnalyticsResponse = {
    ...current,
    courses: projectEntryList(current.courses, overlay, () => false),
    flexibleGoals: projectEntryList(
      current.flexibleGoals,
      overlay,
      () => false,
    ),
    medicalUpcoming: projectEntryList(
      current.medicalUpcoming,
      overlay,
      () => false,
    ),
  }

  if (!completion || !isDateInRange(completion.completedAt, parameters)) {
    return next
  }

  next = {
    ...next,
    exerciseTrends: next.exerciseTrends.map((trend) =>
      trend.itemId !== completion.itemId || completion.measurementValue === null
        ? trend
        : {
            ...trend,
            points: upsertByCompletionId(trend.points, {
              ...toTrendPoint(completion),
              sets: completion.exerciseSets,
              value: completion.measurementValue,
            }),
          },
    ),
    measurementTrends: next.measurementTrends.map((trend) =>
      trend.itemId !== completion.itemId || completion.measurementValue === null
        ? trend
        : {
            ...trend,
            points: upsertByCompletionId(trend.points, {
              ...toTrendPoint(completion),
              value: completion.measurementValue,
            }),
          },
    ),
  }

  if (item) {
    next = {
      ...next,
      courses: replaceItemInEntries(next.courses, item),
      flexibleGoals: replaceItemInEntries(next.flexibleGoals, item),
      medicalUpcoming: replaceItemInEntries(next.medicalUpcoming, item),
    }
  }

  return next
}

function projectSettings(
  current: SelfCareSettingsResponse,
  overlay: SelfCareOfflineOverlay,
): SelfCareSettingsResponse {
  return overlay.result.kind === 'settings' ? overlay.result.value : current
}

function projectDrafts(
  current: SelfCareRitualStepDraftListResponse,
  overlay: SelfCareOfflineOverlay,
): SelfCareRitualStepDraftListResponse {
  return overlay.result.kind === 'ritual_step_drafts' &&
    overlay.result.value.date === current.date
    ? overlay.result.value
    : current
}

function projectEntryList(
  entries: SelfCareTodayItem[],
  overlay: SelfCareOfflineOverlay,
  shouldAddOccurrence: (occurrence: SelfCareOccurrence) => boolean,
): SelfCareTodayItem[] {
  const item = readResultItem(overlay)
  const completion = readResultCompletion(overlay)
  const occurrences = readResultOccurrences(overlay)
  let next = entries

  if (item) {
    next =
      item.isArchived || item.deletedAt
        ? next.filter((entry) => entry.item.id !== item.id)
        : replaceItemInEntries(next, item).map((entry) =>
            entry.item.id === item.id
              ? projectEntryRelations(entry, overlay.command)
              : entry,
          )
  }

  for (const occurrence of occurrences) {
    next = upsertOccurrenceInEntries(
      next,
      occurrence,
      item,
      shouldAddOccurrence,
      overlay.command,
    )
  }

  if (completion) {
    next = next.map((entry) =>
      updateEntryWithCompletion(entry, completion, item, overlay),
    )
  }

  return next
}

function readResultItem(overlay: SelfCareOfflineOverlay): SelfCareItem | null {
  if (overlay.result.kind === 'item') {
    return overlay.result.item
  }

  return overlay.result.kind === 'completion'
    ? (overlay.result.item ?? null)
    : null
}

function readResultCompletion(
  overlay: SelfCareOfflineOverlay,
): SelfCareCompletion | null {
  return overlay.result.kind === 'completion' ? overlay.result.completion : null
}

function readResultOccurrences(
  overlay: SelfCareOfflineOverlay,
): SelfCareOccurrence[] {
  switch (overlay.result.kind) {
    case 'item':
      return [overlay.result.occurrence, overlay.result.replacement].filter(
        (occurrence): occurrence is SelfCareOccurrence => Boolean(occurrence),
      )
    case 'occurrence':
      return [overlay.result.occurrence]
    case 'occurrence_rescheduled':
      return [overlay.result.occurrence, overlay.result.replacement]
    default:
      return []
  }
}

function replaceItemInEntries(
  entries: SelfCareTodayItem[],
  item: SelfCareItem,
): SelfCareTodayItem[] {
  return entries.map((entry) =>
    entry.item.id === item.id ? { ...entry, item } : entry,
  )
}

function ensureItemEntry(
  entries: SelfCareTodayItem[],
  item: SelfCareItem,
  command: SelfCareOfflineCommand,
): SelfCareTodayItem[] {
  return entries.some((entry) => entry.item.id === item.id)
    ? replaceItemInEntries(entries, item).map((entry) =>
        entry.item.id === item.id
          ? projectEntryRelations(entry, command)
          : entry,
      )
    : [...entries, createEntry(item, null, command)]
}

function upsertOccurrenceInEntries(
  entries: SelfCareTodayItem[],
  occurrence: SelfCareOccurrence,
  resultItem: SelfCareItem | null,
  shouldAddOccurrence: (occurrence: SelfCareOccurrence) => boolean,
  command: SelfCareOfflineCommand,
): SelfCareTodayItem[] {
  const index = entries.findIndex(
    (entry) =>
      entry.occurrence?.id === occurrence.id ||
      (entry.item.id === occurrence.itemId &&
        entry.occurrence?.scheduledFor === occurrence.scheduledFor),
  )

  if (index >= 0) {
    return entries.map((entry, candidateIndex) =>
      candidateIndex === index
        ? projectEntryRelations(
            {
              ...entry,
              ...(resultItem ? { item: resultItem } : {}),
              occurrence,
            },
            command,
          )
        : entry,
    )
  }

  const item =
    resultItem?.id === occurrence.itemId
      ? resultItem
      : entries.find((entry) => entry.item.id === occurrence.itemId)?.item

  return item && shouldAddOccurrence(occurrence)
    ? [...entries, createEntry(item, occurrence, command)]
    : entries
}

function updateEntryWithCompletion(
  entry: SelfCareTodayItem,
  completion: SelfCareCompletion,
  resultItem: SelfCareItem | null,
  overlay: SelfCareOfflineOverlay,
): SelfCareTodayItem {
  const matches = completion.occurrenceId
    ? entry.occurrence?.id === completion.occurrenceId
    : entry.item.id === completion.itemId

  if (!matches) {
    return resultItem && entry.item.id === resultItem.id
      ? { ...entry, item: resultItem }
      : entry
  }

  const wasAlreadyApplied = entry.completion?.id === completion.id
  const isProgress = isProgressCompletion(completion)
  const completionResult =
    overlay.result.kind === 'completion' ? overlay.result : null

  const occurrence = entry.occurrence
    ? {
        ...entry.occurrence,
        completedAt: completion.completedAt,
        status:
          completion.status === 'alternative_done'
            ? ('partial' as const)
            : completion.status,
        version: wasAlreadyApplied
          ? entry.occurrence.version
          : getProjectedOccurrenceVersion(entry.occurrence, overlay),
      }
    : null

  const courseDetails = Object.prototype.hasOwnProperty.call(
    completionResult ?? {},
    'courseDetails',
  )
    ? (completionResult?.courseDetails ?? null)
    : entry.courseDetails && isProgress && !wasAlreadyApplied
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
  const flexibleProgress =
    entry.flexibleProgress && isProgress && !wasAlreadyApplied
      ? {
          ...entry.flexibleProgress,
          completedCount: Math.min(
            entry.flexibleProgress.targetCount,
            entry.flexibleProgress.completedCount + 1,
          ),
          remainingCount: Math.max(
            0,
            entry.flexibleProgress.remainingCount - 1,
          ),
        }
      : entry.flexibleProgress

  return {
    ...entry,
    completion,
    courseDetails,
    flexibleProgress,
    ...(resultItem ? { item: resultItem } : {}),
    lastExercise:
      entry.item.type === 'exercise' && completion.measurementValue !== null
        ? completion
        : entry.lastExercise,
    lastMeasurement:
      entry.item.type === 'measurement' && completion.measurementValue !== null
        ? completion
        : entry.lastMeasurement,
    occurrence,
    scheduleRule: Object.prototype.hasOwnProperty.call(
      completionResult ?? {},
      'scheduleRule',
    )
      ? (completionResult?.scheduleRule ?? null)
      : entry.scheduleRule,
  }
}

function getProjectedOccurrenceVersion(
  occurrence: SelfCareOccurrence,
  overlay: SelfCareOfflineOverlay,
): number {
  return overlay.command.type === 'complete_occurrence' &&
    overlay.command.occurrenceId === occurrence.id
    ? overlay.command.expectedVersion + 1
    : occurrence.version
}

function isProgressCompletion(completion: SelfCareCompletion): boolean {
  return (
    completion.status === 'done' ||
    completion.status === 'partial' ||
    completion.status === 'alternative_done'
  )
}

function createEntry(
  item: SelfCareItem,
  occurrence: SelfCareOccurrence | null,
  command: SelfCareOfflineCommand,
): SelfCareTodayItem {
  return projectEntryRelations(
    {
      appointment: null,
      completion: null,
      courseDetails: null,
      exercise: null,
      flexibleProgress: null,
      item,
      lastExercise: null,
      lastMeasurement: null,
      measurement: null,
      occurrence,
      procedure: null,
      scheduleRule: null,
      steps: [],
      timeGroup: item.preferredTimeOfDay ?? 'anytime',
    },
    command,
  )
}

function projectItemRelations(
  current: SelfCareListResponse,
  item: SelfCareItem,
  command: SelfCareOfflineCommand,
): SelfCareListResponse {
  const input = readItemRelationInput(command, item.id)

  if (!input) {
    return current
  }

  let next = current
  const existingSteps = current.steps
    .filter((step) => step.itemId === item.id)
    .sort((left, right) => left.order - right.order)
  const now = item.updatedAt

  if (input.steps !== undefined) {
    const steps = input.steps.map((step, index) => ({
      createdAt: existingSteps[index]?.createdAt ?? now,
      defaultChecked: step.defaultChecked ?? false,
      id: step.id ?? `${item.id}:legacy-offline-step:${index}`,
      isOptional: step.isOptional ?? false,
      itemId: item.id,
      order: step.order ?? index,
      title: step.title,
      updatedAt: now,
    }))
    next = {
      ...next,
      steps: [
        ...next.steps.filter((step) => step.itemId !== item.id),
        ...steps,
      ],
    }
  }

  if (input.alternatives !== undefined) {
    next = {
      ...next,
      alternatives: [
        ...next.alternatives.filter((value) => value.itemId !== item.id),
        ...input.alternatives.map((alternative, index) => ({
          countsAsCompletion: alternative.countsAsCompletion ?? true,
          description: alternative.description ?? '',
          id:
            alternative.id ?? `${item.id}:legacy-offline-alternative:${index}`,
          itemId: item.id,
          title: alternative.title,
        })),
      ],
    }
  }

  if (input.scheduleRule !== undefined) {
    const existing = next.scheduleRules.find(
      (value) => value.itemId === item.id,
    )
    next = {
      ...next,
      scheduleRules: [
        ...next.scheduleRules.filter((value) => value.itemId !== item.id),
        {
          allowMultiplePerDay: input.scheduleRule.allowMultiplePerDay ?? false,
          createdAt: existing?.createdAt ?? now,
          dayOfMonth: input.scheduleRule.dayOfMonth ?? null,
          daysOfWeek: input.scheduleRule.daysOfWeek ?? [],
          endDate: input.scheduleRule.endDate ?? null,
          flexiblePeriod: input.scheduleRule.flexiblePeriod ?? null,
          flexibleTargetCount: input.scheduleRule.flexibleTargetCount ?? null,
          generateInCalendar: input.scheduleRule.generateInCalendar ?? false,
          generateInTaskList: input.scheduleRule.generateInTaskList ?? true,
          id:
            input.scheduleRule.id ??
            existing?.id ??
            `${item.id}:legacy-offline-rule`,
          intervalUnit: input.scheduleRule.intervalUnit ?? null,
          intervalValue: input.scheduleRule.intervalValue ?? null,
          itemId: item.id,
          monthOfYear: input.scheduleRule.monthOfYear ?? null,
          preferredTime: input.scheduleRule.preferredTime ?? null,
          reminderOffsetsMinutes:
            input.scheduleRule.reminderOffsetsMinutes ?? [],
          repeatKind: input.scheduleRule.repeatKind,
          startDate: input.scheduleRule.startDate ?? null,
          timezone: input.scheduleRule.timezone ?? null,
          updatedAt: now,
          weekOfMonth: input.scheduleRule.weekOfMonth ?? null,
        },
      ],
    }
  }

  next = projectProcedureDetails(next, item, input, now)
  next = projectAppointmentDetails(next, item, input, now)
  next = projectMedicalDetails(next, item, input, now)
  next = projectCourseDetails(next, item, input, now)
  next = projectMeasurementDetails(next, item, input, now)
  next = projectExerciseDetails(next, item, input, now)

  return next
}

type SelfCareRelationInput =
  | Extract<SelfCareOfflineCommand, { type: 'create_item' }>['input']
  | Extract<
      SelfCareOfflineCommand,
      { type: 'create_item_from_template' }
    >['overrides']
  | Extract<SelfCareOfflineCommand, { type: 'update_item' }>['input']

function readItemRelationInput(
  command: SelfCareOfflineCommand,
  itemId: string,
): SelfCareRelationInput | null {
  switch (command.type) {
    case 'create_item':
      return command.input.id === itemId ? command.input : null
    case 'create_item_from_template':
      return command.itemId === itemId ? command.overrides : null
    case 'update_item':
      return command.itemId === itemId ? command.input : null
    default:
      return null
  }
}

function projectEntryRelations(
  entry: SelfCareTodayItem,
  command: SelfCareOfflineCommand,
): SelfCareTodayItem {
  const input = readItemRelationInput(command, entry.item.id)

  if (!input) {
    return entry
  }

  const now = entry.item.updatedAt
  const courseDetails = input.courseDetails
    ? {
        breakDays: input.courseDetails.breakDays ?? 0,
        completedCount: input.courseDetails.completedCount ?? 0,
        courseType: input.courseDetails.courseType,
        createdAt: entry.courseDetails?.createdAt ?? now,
        endDate: input.courseDetails.endDate ?? null,
        id: entry.courseDetails?.id ?? `${entry.item.id}:offline-course`,
        isCompleted: input.courseDetails.isCompleted ?? false,
        isPaused: input.courseDetails.isPaused ?? false,
        itemId: entry.item.id,
        repeatAfterCompletion:
          input.courseDetails.repeatAfterCompletion ?? false,
        startDate: input.courseDetails.startDate ?? null,
        totalCount: input.courseDetails.totalCount,
        updatedAt: now,
      }
    : entry.courseDetails
  const scheduleRule = input.scheduleRule
    ? {
        allowMultiplePerDay: input.scheduleRule.allowMultiplePerDay ?? false,
        createdAt: entry.scheduleRule?.createdAt ?? now,
        dayOfMonth: input.scheduleRule.dayOfMonth ?? null,
        daysOfWeek: input.scheduleRule.daysOfWeek ?? [],
        endDate: input.scheduleRule.endDate ?? null,
        flexiblePeriod: input.scheduleRule.flexiblePeriod ?? null,
        flexibleTargetCount: input.scheduleRule.flexibleTargetCount ?? null,
        generateInCalendar: input.scheduleRule.generateInCalendar ?? false,
        generateInTaskList: input.scheduleRule.generateInTaskList ?? true,
        id:
          input.scheduleRule.id ??
          entry.scheduleRule?.id ??
          `${entry.item.id}:legacy-offline-rule`,
        intervalUnit: input.scheduleRule.intervalUnit ?? null,
        intervalValue: input.scheduleRule.intervalValue ?? null,
        itemId: entry.item.id,
        monthOfYear: input.scheduleRule.monthOfYear ?? null,
        preferredTime: input.scheduleRule.preferredTime ?? null,
        reminderOffsetsMinutes: input.scheduleRule.reminderOffsetsMinutes ?? [],
        repeatKind: input.scheduleRule.repeatKind,
        startDate: input.scheduleRule.startDate ?? null,
        timezone: input.scheduleRule.timezone ?? null,
        updatedAt: now,
        weekOfMonth: input.scheduleRule.weekOfMonth ?? null,
      }
    : entry.scheduleRule
  const steps =
    input.steps === undefined
      ? entry.steps
      : input.steps.map((step, index) => ({
          createdAt: entry.steps[index]?.createdAt ?? now,
          defaultChecked: step.defaultChecked ?? false,
          id: step.id ?? `${entry.item.id}:legacy-offline-step:${index}`,
          isOptional: step.isOptional ?? false,
          itemId: entry.item.id,
          order: step.order ?? index,
          title: step.title,
          updatedAt: now,
        }))

  return {
    ...entry,
    appointment: input.appointmentDetails
      ? {
          createdAt: entry.appointment?.createdAt ?? now,
          currency: input.appointmentDetails.currency ?? null,
          endsAt: input.appointmentDetails.endsAt ?? null,
          id: entry.appointment?.id ?? `${entry.item.id}:offline-appointment`,
          itemId: entry.item.id,
          occurrenceId: entry.occurrence?.id ?? null,
          place: input.appointmentDetails.place ?? null,
          preparationNote: input.appointmentDetails.preparationNote ?? null,
          price: input.appointmentDetails.price ?? null,
          resultNote: input.appointmentDetails.resultNote ?? null,
          specialistContact: input.appointmentDetails.specialistContact ?? null,
          specialistName: input.appointmentDetails.specialistName ?? null,
          startsAt: input.appointmentDetails.startsAt,
          updatedAt: now,
        }
      : entry.appointment,
    courseDetails,
    exercise: input.exerciseDetails
      ? {
          createdAt: entry.exercise?.createdAt ?? now,
          id: entry.exercise?.id ?? `${entry.item.id}:offline-exercise`,
          itemId: entry.item.id,
          metricType: input.exerciseDetails.metricType,
          plannedSets: input.exerciseDetails.plannedSets ?? null,
          plannedValue: input.exerciseDetails.plannedValue ?? null,
          unit: input.exerciseDetails.unit,
          updatedAt: now,
          useSets: input.exerciseDetails.useSets ?? false,
        }
      : entry.exercise,
    measurement: input.measurementDetails
      ? {
          createdAt: entry.measurement?.createdAt ?? now,
          id: entry.measurement?.id ?? `${entry.item.id}:offline-measurement`,
          itemId: entry.item.id,
          targetMax: input.measurementDetails.targetMax ?? null,
          targetMin: input.measurementDetails.targetMin ?? null,
          unit: input.measurementDetails.unit,
          updatedAt: now,
          valueLabel: input.measurementDetails.valueLabel ?? 'Значение',
        }
      : entry.measurement,
    procedure: input.procedureDetails
      ? {
          contact: input.procedureDetails.contact ?? null,
          createdAt: entry.procedure?.createdAt ?? now,
          currency: input.procedureDetails.currency ?? null,
          defaultPrice: input.procedureDetails.defaultPrice ?? null,
          id: entry.procedure?.id ?? `${entry.item.id}:offline-procedure`,
          itemId: entry.item.id,
          place: input.procedureDetails.place ?? null,
          specialistName: input.procedureDetails.specialistName ?? null,
          updatedAt: now,
        }
      : entry.procedure,
    scheduleRule,
    steps,
  }
}

function projectProcedureDetails(
  current: SelfCareListResponse,
  item: SelfCareItem,
  input: SelfCareRelationInput,
  now: string,
): SelfCareListResponse {
  if (!input.procedureDetails) return current
  const existing = current.procedureDetails.find(
    (value) => value.itemId === item.id,
  )
  return {
    ...current,
    procedureDetails: [
      ...current.procedureDetails.filter((value) => value.itemId !== item.id),
      {
        contact: input.procedureDetails.contact ?? null,
        createdAt: existing?.createdAt ?? now,
        currency: input.procedureDetails.currency ?? null,
        defaultPrice: input.procedureDetails.defaultPrice ?? null,
        id: existing?.id ?? `${item.id}:offline-procedure`,
        itemId: item.id,
        place: input.procedureDetails.place ?? null,
        specialistName: input.procedureDetails.specialistName ?? null,
        updatedAt: now,
      },
    ],
  }
}

function projectAppointmentDetails(
  current: SelfCareListResponse,
  item: SelfCareItem,
  input: SelfCareRelationInput,
  now: string,
): SelfCareListResponse {
  if (!input.appointmentDetails) return current
  const existing = current.appointmentDetails.find(
    (value) => value.itemId === item.id,
  )
  return {
    ...current,
    appointmentDetails: [
      ...current.appointmentDetails.filter((value) => value.itemId !== item.id),
      {
        createdAt: existing?.createdAt ?? now,
        currency: input.appointmentDetails.currency ?? null,
        endsAt: input.appointmentDetails.endsAt ?? null,
        id: existing?.id ?? `${item.id}:offline-appointment`,
        itemId: item.id,
        occurrenceId: existing?.occurrenceId ?? null,
        place: input.appointmentDetails.place ?? null,
        preparationNote: input.appointmentDetails.preparationNote ?? null,
        price: input.appointmentDetails.price ?? null,
        resultNote: input.appointmentDetails.resultNote ?? null,
        specialistContact: input.appointmentDetails.specialistContact ?? null,
        specialistName: input.appointmentDetails.specialistName ?? null,
        startsAt: input.appointmentDetails.startsAt,
        updatedAt: now,
      },
    ],
  }
}

function projectMedicalDetails(
  current: SelfCareListResponse,
  item: SelfCareItem,
  input: SelfCareRelationInput,
  now: string,
): SelfCareListResponse {
  if (!input.medicalDetails) return current
  const existing = current.medicalDetails.find(
    (value) => value.itemId === item.id,
  )
  return {
    ...current,
    medicalDetails: [
      ...current.medicalDetails.filter((value) => value.itemId !== item.id),
      {
        analysisList: input.medicalDetails.analysisList ?? [],
        clinicAddress: input.medicalDetails.clinicAddress ?? null,
        clinicName: input.medicalDetails.clinicName ?? null,
        createdAt: existing?.createdAt ?? now,
        documentUrls: input.medicalDetails.documentUrls ?? [],
        doctorName: input.medicalDetails.doctorName ?? null,
        id: existing?.id ?? `${item.id}:offline-medical`,
        itemId: item.id,
        nextControlDate: input.medicalDetails.nextControlDate ?? null,
        phone: input.medicalDetails.phone ?? null,
        reminderStrategy: input.medicalDetails.reminderStrategy ?? 'soft',
        resultNote: input.medicalDetails.resultNote ?? null,
        updatedAt: now,
        website: input.medicalDetails.website ?? null,
      },
    ],
  }
}

function projectCourseDetails(
  current: SelfCareListResponse,
  item: SelfCareItem,
  input: SelfCareRelationInput,
  now: string,
): SelfCareListResponse {
  if (!input.courseDetails) return current
  const existing = current.courseDetails.find(
    (value) => value.itemId === item.id,
  )
  return {
    ...current,
    courseDetails: [
      ...current.courseDetails.filter((value) => value.itemId !== item.id),
      {
        breakDays: input.courseDetails.breakDays ?? 0,
        completedCount: input.courseDetails.completedCount ?? 0,
        courseType: input.courseDetails.courseType,
        createdAt: existing?.createdAt ?? now,
        endDate: input.courseDetails.endDate ?? null,
        id: existing?.id ?? `${item.id}:offline-course`,
        isCompleted: input.courseDetails.isCompleted ?? false,
        isPaused: input.courseDetails.isPaused ?? false,
        itemId: item.id,
        repeatAfterCompletion:
          input.courseDetails.repeatAfterCompletion ?? false,
        startDate: input.courseDetails.startDate ?? null,
        totalCount: input.courseDetails.totalCount,
        updatedAt: now,
      },
    ],
  }
}

function projectMeasurementDetails(
  current: SelfCareListResponse,
  item: SelfCareItem,
  input: SelfCareRelationInput,
  now: string,
): SelfCareListResponse {
  if (!input.measurementDetails) return current
  const existing = current.measurementDetails.find(
    (value) => value.itemId === item.id,
  )
  return {
    ...current,
    measurementDetails: [
      ...current.measurementDetails.filter((value) => value.itemId !== item.id),
      {
        createdAt: existing?.createdAt ?? now,
        id: existing?.id ?? `${item.id}:offline-measurement`,
        itemId: item.id,
        targetMax: input.measurementDetails.targetMax ?? null,
        targetMin: input.measurementDetails.targetMin ?? null,
        unit: input.measurementDetails.unit,
        updatedAt: now,
        valueLabel: input.measurementDetails.valueLabel ?? 'Значение',
      },
    ],
  }
}

function projectExerciseDetails(
  current: SelfCareListResponse,
  item: SelfCareItem,
  input: SelfCareRelationInput,
  now: string,
): SelfCareListResponse {
  if (!input.exerciseDetails) return current
  const existing = current.exerciseDetails.find(
    (value) => value.itemId === item.id,
  )
  return {
    ...current,
    exerciseDetails: [
      ...current.exerciseDetails.filter((value) => value.itemId !== item.id),
      {
        createdAt: existing?.createdAt ?? now,
        id: existing?.id ?? `${item.id}:offline-exercise`,
        itemId: item.id,
        metricType: input.exerciseDetails.metricType,
        plannedSets: input.exerciseDetails.plannedSets ?? null,
        plannedValue: input.exerciseDetails.plannedValue ?? null,
        unit: input.exerciseDetails.unit,
        updatedAt: now,
        useSets: input.exerciseDetails.useSets ?? false,
      },
    ],
  }
}

function removeItemRelations(
  current: SelfCareListResponse,
  itemId: string,
): SelfCareListResponse {
  return {
    ...current,
    alternatives: current.alternatives.filter(
      (value) => value.itemId !== itemId,
    ),
    appointmentDetails: current.appointmentDetails.filter(
      (value) => value.itemId !== itemId,
    ),
    courseDetails: current.courseDetails.filter(
      (value) => value.itemId !== itemId,
    ),
    exerciseDetails: current.exerciseDetails.filter(
      (value) => value.itemId !== itemId,
    ),
    medicalDetails: current.medicalDetails.filter(
      (value) => value.itemId !== itemId,
    ),
    measurementDetails: current.measurementDetails.filter(
      (value) => value.itemId !== itemId,
    ),
    procedureDetails: current.procedureDetails.filter(
      (value) => value.itemId !== itemId,
    ),
    scheduleRules: current.scheduleRules.filter(
      (value) => value.itemId !== itemId,
    ),
    steps: current.steps.filter((value) => value.itemId !== itemId),
  }
}

function toTrendPoint(completion: SelfCareCompletion) {
  return {
    alternativeTitle: completion.alternativeTitle,
    completedAt: completion.completedAt,
    completedVariant: completion.completedVariant,
    completionId: completion.id,
    date: completion.completedAt.slice(0, 10),
    durationMinutes: completion.durationMinutes,
    energyAfter: completion.energyAfter,
    energyBefore: completion.energyBefore,
    moodAfter: completion.moodAfter,
    moodBefore: completion.moodBefore,
    note: completion.note,
    scheduledFor: completion.scheduledFor,
    status: completion.status,
  }
}

function upsertById<T extends { id: string }>(values: T[], value: T): T[] {
  const index = values.findIndex((candidate) => candidate.id === value.id)

  if (index < 0) {
    return [...values, value]
  }

  return values.map((candidate, candidateIndex) =>
    candidateIndex === index ? value : candidate,
  )
}

function upsertByCompletionId<T extends { completionId: string }>(
  values: T[],
  value: T,
): T[] {
  const index = values.findIndex(
    (candidate) => candidate.completionId === value.completionId,
  )

  if (index < 0) {
    return [...values, value]
  }

  return values.map((candidate, candidateIndex) =>
    candidateIndex === index ? value : candidate,
  )
}

function readCacheParameters(scope: string, cacheKey: string): string[] {
  const prefix = `${scope}:`

  if (!cacheKey.startsWith(prefix)) {
    return []
  }

  return cacheKey
    .slice(prefix.length)
    .split(':')
    .filter(Boolean)
    .map((value) => decodeURIComponent(value))
}

function isOccurrenceOnDate(
  occurrence: SelfCareOccurrence,
  date: string,
): boolean {
  return occurrence.scheduledFor === date
}

function isOccurrenceBeforeDate(
  occurrence: SelfCareOccurrence,
  date: string,
): boolean {
  return occurrence.scheduledFor < date && occurrence.status === 'scheduled'
}

function isDateInRange(
  timestamp: string,
  parameters: readonly string[],
): boolean {
  if (parameters.length < 2) {
    return true
  }

  const date = timestamp.slice(0, 10)
  return date >= parameters[0]! && date <= parameters[1]!
}
