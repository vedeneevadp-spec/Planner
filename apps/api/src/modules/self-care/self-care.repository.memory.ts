/* eslint-disable @typescript-eslint/require-await */
import type {
  SelfCareAppointmentDetails,
  SelfCareCompletion,
  SelfCareCourseDetails,
  SelfCareItemAlternative,
  SelfCareMeasurementDetails,
  SelfCareMedicalDetails,
  SelfCareMinimumItem,
  SelfCareProcedureDetails,
  SelfCareRitualStep,
  SelfCareRitualStepCompletion,
  SelfCareScheduleRule,
  SelfCareSettings,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  ArchiveSelfCareItemCommand,
  CancelSelfCareOccurrenceCommand,
  CompleteCourseSessionCommand,
  CompleteFlexibleGoalCommand,
  CompleteSelfCareItemNowCommand,
  CompleteSelfCareOccurrenceCommand,
  CreateSelfCareItemCommand,
  CreateSelfCareItemFromTemplateCommand,
  DeleteSelfCareItemCommand,
  DeleteSelfCareRitualStepDraftCommand,
  GenerateSelfCareOccurrencesCommand,
  GetSelfCareDashboardCommand,
  GetSelfCareOccurrencesCommand,
  GetSelfCarePlanCommand,
  GetSelfCareRitualStepDraftsCommand,
  MoveSelfCareOccurrenceCommand,
  RestoreSelfCareItemCommand,
  ScheduleSelfCareItemCommand,
  SelfCareListFilters,
  SelfCareReadContext,
  SelfCareWriteContext,
  SkipSelfCareOccurrenceCommand,
  StoredSelfCareCompletionRecord,
  StoredSelfCareDailyStateRecord,
  StoredSelfCareItemRecord,
  StoredSelfCareOccurrenceRecord,
  StoredSelfCareRitualStepDraftRecord,
  ToggleSelfCareGentleModeCommand,
  UpdateSelfCareItemCommand,
  UpdateSelfCareMinimumItemsCommand,
  UpdateSelfCareRitualStepsCommand,
  UpdateSelfCareSettingsCommand,
  UpsertSelfCareDailyStateCommand,
  UpsertSelfCareRitualStepDraftCommand,
} from './self-care.model.js'
import type { SelfCareRepository } from './self-care.repository.js'
import {
  buildAnalyticsResponse,
  buildDashboardResponse,
  buildDueAt,
  buildHistoryResponse,
  buildItemInputFromTemplate,
  buildPlanResponse,
  buildSelfCareListResponse,
  buildSystemSelfCareTemplates,
  createAppointmentDetailsRecord,
  createCompletionRecord,
  createCourseDetailsRecord,
  createDailyStateRecord,
  createDefaultMinimumItems,
  createDefaultSelfCareSettings,
  createMeasurementDetailsRecord,
  createMedicalDetailsRecord,
  createMinimumItemRecord,
  createOccurrenceRecord,
  createProcedureDetailsRecord,
  createRitualStepCompletions,
  createRitualStepRecord,
  createScheduleRuleRecord,
  createSelfCareRecords,
  generateSelfCareOccurrencesForRange,
  getSelfCareCompletionDateKey,
  inferRitualCompletionStatus,
  isCompletionProgressStatus,
  shouldDeduplicateSelfCareItemCompletion,
  shouldMarkSelfCareOccurrenceMissed,
  updateOccurrenceStatus,
} from './self-care.shared.js'

export class MemorySelfCareRepository implements SelfCareRepository {
  private readonly alternatives = new Map<string, SelfCareItemAlternative>()
  private readonly appointmentDetails = new Map<
    string,
    SelfCareAppointmentDetails
  >()
  private readonly completions = new Map<string, SelfCareCompletion>()
  private readonly courseDetails = new Map<string, SelfCareCourseDetails>()
  private readonly dailyStates = new Map<
    string,
    StoredSelfCareDailyStateRecord
  >()
  private readonly items = new Map<string, StoredSelfCareItemRecord>()
  private readonly medicalDetails = new Map<string, SelfCareMedicalDetails>()
  private readonly measurementDetails = new Map<
    string,
    SelfCareMeasurementDetails
  >()
  private readonly minimumItems = new Map<string, SelfCareMinimumItem>()
  private readonly occurrences = new Map<
    string,
    StoredSelfCareOccurrenceRecord
  >()
  private readonly procedureDetails = new Map<
    string,
    SelfCareProcedureDetails
  >()
  private readonly scheduleRules = new Map<string, SelfCareScheduleRule>()
  private readonly settings = new Map<string, SelfCareSettings>()
  private readonly stepCompletions = new Map<
    string,
    SelfCareRitualStepCompletion
  >()
  private readonly stepDrafts = new Map<
    string,
    StoredSelfCareRitualStepDraftRecord
  >()
  private readonly steps = new Map<string, SelfCareRitualStep>()
  private readonly templates = buildSystemSelfCareTemplates()

  async listItems(
    context: SelfCareReadContext,
    filters: SelfCareListFilters = {},
  ) {
    return buildSelfCareListResponse(this.loadState(context), filters)
  }

  async createItem(command: CreateSelfCareItemCommand) {
    const records = createSelfCareRecords(command.input, {
      actorUserId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })
    this.storeCreatedRecords(records)
    return records.item
  }

  async updateItem(command: UpdateSelfCareItemCommand) {
    const item = this.getWritableItem(command.context, command.itemId)

    if (
      command.input.expectedVersion !== undefined &&
      command.input.expectedVersion !== item.version
    ) {
      throw new HttpError(
        409,
        'self_care_item_version_conflict',
        'Self-care item was changed on the server.',
      )
    }

    const now = new Date().toISOString()
    const nextItem: StoredSelfCareItemRecord = {
      ...item,
      ...(command.input.category !== undefined
        ? { category: command.input.category }
        : {}),
      ...(command.input.color !== undefined
        ? { color: command.input.color }
        : {}),
      ...(command.input.customCategoryId !== undefined
        ? { customCategoryId: command.input.customCategoryId }
        : {}),
      ...(command.input.defaultDurationMinutes !== undefined
        ? { defaultDurationMinutes: command.input.defaultDurationMinutes }
        : {}),
      ...(command.input.description !== undefined
        ? { description: command.input.description }
        : {}),
      ...(command.input.icon !== undefined ? { icon: command.input.icon } : {}),
      ...(command.input.importance !== undefined
        ? { importance: command.input.importance }
        : {}),
      ...(command.input.isActive !== undefined
        ? { isActive: command.input.isActive }
        : {}),
      ...(command.input.isArchived !== undefined
        ? { isArchived: command.input.isArchived }
        : {}),
      ...(command.input.isPrivate !== undefined
        ? { isPrivate: command.input.isPrivate }
        : {}),
      ...(command.input.minimumVersion !== undefined
        ? {
            minimumVersionDescription:
              command.input.minimumVersion?.description || null,
            minimumVersionDurationMinutes:
              command.input.minimumVersion?.durationMinutes ?? null,
            minimumVersionTitle: command.input.minimumVersion?.title ?? null,
          }
        : {}),
      ...(command.input.preferredTimeOfDay !== undefined
        ? { preferredTimeOfDay: command.input.preferredTimeOfDay }
        : {}),
      ...(command.input.title !== undefined
        ? { title: command.input.title }
        : {}),
      ...(command.input.type !== undefined ? { type: command.input.type } : {}),
      updatedAt: now,
      version: item.version + 1,
    }

    this.items.set(nextItem.id, nextItem)

    if (command.input.scheduleRule) {
      const existingRule =
        [...this.scheduleRules.values()].find(
          (candidate) => candidate.itemId === nextItem.id,
        ) ?? null
      const rule = createScheduleRuleRecord(
        nextItem.id,
        {
          ...command.input.scheduleRule,
          id: existingRule?.id ?? command.input.scheduleRule.id,
        },
        now,
      )
      this.scheduleRules.set(rule.id, rule)
      this.relinkOpenOccurrencesToScheduleRule(rule)
    }

    if (command.input.steps) {
      this.deleteForItem(this.steps, nextItem.id)
      this.deleteForItem(this.stepDrafts, nextItem.id)
      command.input.steps.forEach((step, index) => {
        const record = createRitualStepRecord(nextItem.id, step, index, now)
        this.steps.set(record.id, record)
      })
    }

    if (command.input.alternatives) {
      this.deleteForItem(this.alternatives, nextItem.id)
      command.input.alternatives.forEach((alternative) => {
        const record = {
          countsAsCompletion: alternative.countsAsCompletion,
          description: alternative.description,
          id: alternative.id ?? `${nextItem.id}-${alternative.title}`,
          itemId: nextItem.id,
          title: alternative.title,
        }
        this.alternatives.set(record.id, record)
      })
    }

    if (command.input.procedureDetails) {
      this.deleteForItem(this.procedureDetails, nextItem.id)
      const record = createProcedureDetailsRecord(
        nextItem.id,
        command.input.procedureDetails,
        now,
      )
      this.procedureDetails.set(record.id, record)
    }

    if (command.input.appointmentDetails) {
      this.deleteForItem(this.appointmentDetails, nextItem.id)
      const record = createAppointmentDetailsRecord(
        nextItem.id,
        command.input.appointmentDetails,
        now,
      )
      this.appointmentDetails.set(record.id, record)
    }

    if (command.input.medicalDetails) {
      this.deleteForItem(this.medicalDetails, nextItem.id)
      const record = createMedicalDetailsRecord(
        nextItem.id,
        command.input.medicalDetails,
        now,
      )
      this.medicalDetails.set(record.id, record)
    }

    if (command.input.measurementDetails) {
      this.deleteForItem(this.measurementDetails, nextItem.id)
      const record = createMeasurementDetailsRecord(
        nextItem.id,
        command.input.measurementDetails,
        now,
      )
      this.measurementDetails.set(record.id, record)
    }

    if (command.input.courseDetails) {
      this.deleteForItem(this.courseDetails, nextItem.id)
      const record = createCourseDetailsRecord(
        nextItem.id,
        command.input.courseDetails,
        now,
      )
      this.courseDetails.set(record.id, record)
    }

    return nextItem
  }

  async archiveItem(command: ArchiveSelfCareItemCommand) {
    return this.setArchiveState(command.context, command.itemId, true)
  }

  async restoreItem(command: RestoreSelfCareItemCommand) {
    return this.setArchiveState(command.context, command.itemId, false)
  }

  async deleteItem(command: DeleteSelfCareItemCommand) {
    const item = this.getWritableItem(command.context, command.itemId)
    this.items.set(item.id, {
      ...item,
      deletedAt: new Date().toISOString(),
      isActive: false,
      isArchived: true,
      version: item.version + 1,
    })
    this.deleteForItem(this.stepDrafts, item.id)
  }

  async generateOccurrences(command: GenerateSelfCareOccurrencesCommand) {
    const state = this.loadState(command.context)
    const generated: StoredSelfCareOccurrenceRecord[] = []

    for (const item of state.items) {
      const rule =
        state.scheduleRules.find((candidate) => candidate.itemId === item.id) ??
        null
      const course =
        state.courseDetails.find((candidate) => candidate.itemId === item.id) ??
        null
      const occurrences = generateSelfCareOccurrencesForRange({
        completions: state.completions,
        courseDetails: course,
        existingOccurrences: state.occurrences,
        from: command.from,
        item,
        scheduleRule: rule,
        to: command.to,
      })

      for (const occurrence of occurrences) {
        this.occurrences.set(occurrence.id, occurrence)
        generated.push(occurrence)
      }
    }

    return generated
  }

  async getDashboard(command: GetSelfCareDashboardCommand) {
    this.generateReadOccurrences(command.context, command.date, command.date)
    this.markMissedOccurrences(command.context, command.date)
    return buildDashboardResponse({
      date: command.date,
      state: this.loadState(command.context),
    })
  }

  async getPlan(command: GetSelfCarePlanCommand) {
    this.generateReadOccurrences(command.context, command.from, command.to)
    this.markMissedOccurrences(command.context, command.from)
    return buildPlanResponse({
      from: command.from,
      state: this.loadState(command.context),
      to: command.to,
    })
  }

  async getOccurrences(command: GetSelfCareOccurrencesCommand) {
    this.generateReadOccurrences(command.context, command.from, command.to)
    this.markMissedOccurrences(command.context, command.from)
    return this.loadState(command.context).occurrences.filter(
      (occurrence) =>
        occurrence.scheduledFor >= command.from &&
        occurrence.scheduledFor <= command.to,
    )
  }

  async completeOccurrence(command: CompleteSelfCareOccurrenceCommand) {
    const occurrence = this.getOccurrence(command.context, command.occurrenceId)
    const item = this.getWritableItem(command.context, occurrence.itemId)
    assertMeasurementCompletionInput(item, command.input)
    assertMoodCheckCompletionInput(item, command.input)
    const stepCompletions = createRitualStepCompletions(
      'pending',
      command.input,
    )
    const status = inferRitualCompletionStatus({
      requestedStatus: command.input.status,
      stepCompletions,
      steps: this.loadStepsForItem(item.id),
    })
    const completion = createCompletionRecord(
      { ...command.input, status },
      {
        itemId: item.id,
        occurrence,
        userId: command.context.actorUserId,
      },
    )
    const finalStepCompletions = stepCompletions.map((step) => ({
      ...step,
      completionId: completion.id,
    }))

    this.completions.set(completion.id, completion)
    finalStepCompletions.forEach((step) =>
      this.stepCompletions.set(step.id, step),
    )
    this.occurrences.set(
      occurrence.id,
      updateOccurrenceStatus(
        occurrence,
        mapCompletionStatusToOccurrenceStatus(status),
        {
          completedAt: completion.completedAt,
        },
      ),
    )
    this.deleteRitualStepDraftRecord({
      date: getSelfCareCompletionDateKey(command.input),
      itemId: item.id,
      occurrenceId: occurrence.id,
      userId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })
    this.deleteRitualStepDraftRecord({
      date: occurrence.scheduledFor,
      itemId: item.id,
      occurrenceId: occurrence.id,
      userId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })
    this.incrementCourseIfNeeded(item.id)

    return completion
  }

  async completeItemNow(command: CompleteSelfCareItemNowCommand) {
    const item = this.getWritableItem(command.context, command.itemId)
    assertMeasurementCompletionInput(item, command.input)
    assertMoodCheckCompletionInput(item, command.input)
    const scheduleRule = this.findScheduleRuleForItem(item.id)
    const completionDate = getSelfCareCompletionDateKey(command.input)
    const existingCompletion = shouldDeduplicateSelfCareItemCompletion({
      item,
      scheduleRule,
    })
      ? this.findProgressCompletionForDate({
          date: completionDate,
          itemId: item.id,
          userId: command.context.actorUserId,
        })
      : null

    if (existingCompletion) {
      return existingCompletion
    }

    const pendingStepCompletions = createRitualStepCompletions(
      'pending',
      command.input,
    )
    const status = inferRitualCompletionStatus({
      requestedStatus: command.input.status,
      stepCompletions: pendingStepCompletions,
      steps: this.loadStepsForItem(item.id),
    })
    const completion = createCompletionRecord(
      { ...command.input, status },
      {
        itemId: item.id,
        scheduledFor: completionDate,
        userId: command.context.actorUserId,
      },
    )
    const finalStepCompletions = pendingStepCompletions.map((step) => ({
      ...step,
      completionId: completion.id,
    }))

    this.completions.set(completion.id, completion)
    finalStepCompletions.forEach((step) =>
      this.stepCompletions.set(step.id, step),
    )
    this.deleteRitualStepDraftRecord({
      date: completionDate,
      itemId: item.id,
      occurrenceId: null,
      userId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })
    this.incrementCourseIfNeeded(item.id)
    return completion
  }

  async completeFlexibleGoal(command: CompleteFlexibleGoalCommand) {
    return this.completeItemNow({
      context: command.context,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })
  }

  async completeCourseSession(command: CompleteCourseSessionCommand) {
    return this.completeItemNow({
      context: command.context,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })
  }

  async skipOccurrence(command: SkipSelfCareOccurrenceCommand) {
    const occurrence = this.getOccurrence(command.context, command.occurrenceId)
    const completion = createCompletionRecord(
      {
        alternativeTitle: null,
        completedVariant: null,
        durationMinutes: null,
        energyAfter: null,
        energyBefore: null,
        measurementUnit: null,
        measurementValue: null,
        moodAfter: null,
        moodBefore: null,
        note: command.input.reason,
        status: 'skipped',
      },
      {
        itemId: occurrence.itemId,
        occurrence,
        userId: command.context.actorUserId,
      },
    )
    this.completions.set(completion.id, completion)
    const nextOccurrence = updateOccurrenceStatus(occurrence, 'skipped')
    this.occurrences.set(nextOccurrence.id, nextOccurrence)
    return nextOccurrence
  }

  async moveOccurrence(command: MoveSelfCareOccurrenceCommand) {
    const occurrence = this.getOccurrence(command.context, command.occurrenceId)
    const completion = createCompletionRecord(
      {
        alternativeTitle: null,
        completedVariant: null,
        durationMinutes: null,
        energyAfter: null,
        energyBefore: null,
        measurementUnit: null,
        measurementValue: null,
        moodAfter: null,
        moodBefore: null,
        note: command.input.note,
        status: 'moved',
      },
      {
        itemId: occurrence.itemId,
        occurrence,
        userId: command.context.actorUserId,
      },
    )
    this.completions.set(completion.id, completion)
    const nextOccurrence = updateOccurrenceStatus(occurrence, 'moved', {
      movedTo: command.input.newDate,
    })
    this.occurrences.set(nextOccurrence.id, nextOccurrence)
    return nextOccurrence
  }

  async scheduleItem(command: ScheduleSelfCareItemCommand) {
    const item = this.getWritableItem(command.context, command.itemId)
    const scheduleRule =
      [...this.scheduleRules.values()].find(
        (candidate) => candidate.itemId === item.id,
      ) ?? null
    const scheduledTime = command.input.scheduledTime ?? null
    const dueAt = buildDueAt(
      command.input.scheduledFor,
      scheduledTime ?? scheduleRule?.preferredTime ?? null,
    )
    const existing = [...this.occurrences.values()].find(
      (occurrence) =>
        occurrence.itemId === item.id &&
        isSameScheduleSlot(occurrence, scheduleRule) &&
        occurrence.scheduledFor === command.input.scheduledFor,
    )

    if (existing) {
      const nextOccurrence = {
        ...existing,
        completedAt: null,
        dueAt,
        movedTo: null,
        scheduleRuleId: scheduleRule?.id ?? null,
        status: 'scheduled' as const,
        updatedAt: new Date().toISOString(),
      }
      this.occurrences.set(nextOccurrence.id, nextOccurrence)
      this.upsertScheduledDetails(item, nextOccurrence, command.input)
      return nextOccurrence
    }

    const occurrence = createOccurrenceRecord({
      dueAt,
      item,
      scheduledFor: command.input.scheduledFor,
      scheduleRule,
    })
    this.occurrences.set(occurrence.id, occurrence)
    this.upsertScheduledDetails(item, occurrence, command.input)
    return occurrence
  }

  private upsertScheduledDetails(
    item: StoredSelfCareItemRecord,
    occurrence: StoredSelfCareOccurrenceRecord,
    input: ScheduleSelfCareItemCommand['input'],
  ): void {
    const now = new Date().toISOString()

    if (shouldStoreAppointmentDetails(item, input)) {
      const startsAt =
        occurrence.dueAt ?? buildScheduleDetailsStartsAt(input.scheduledFor)
      const existing = [...this.appointmentDetails.values()].find(
        (details) => details.occurrenceId === occurrence.id,
      )
      const details = existing
        ? {
            ...existing,
            currency: input.currency,
            place: input.place,
            preparationNote: input.note,
            price: input.price,
            specialistContact: input.specialistContact,
            specialistName: input.specialistName,
            startsAt,
            updatedAt: now,
          }
        : {
            ...createAppointmentDetailsRecord(
              item.id,
              {
                currency: input.currency,
                endsAt: null,
                place: input.place,
                preparationNote: input.note,
                price: input.price,
                resultNote: null,
                specialistContact: input.specialistContact,
                specialistName: input.specialistName,
                startsAt,
              },
              now,
            ),
            occurrenceId: occurrence.id,
          }
      this.appointmentDetails.set(details.id, details)
    }

    if (item.type === 'procedure' && hasScheduleDetails(input)) {
      const existing = [...this.procedureDetails.values()].find(
        (details) => details.itemId === item.id,
      )
      const details = existing
        ? {
            ...existing,
            contact: input.specialistContact,
            currency: input.currency,
            defaultPrice: input.price,
            place: input.place,
            specialistName: input.specialistName,
            updatedAt: now,
          }
        : createProcedureDetailsRecord(
            item.id,
            {
              contact: input.specialistContact,
              currency: input.currency,
              defaultPrice: input.price,
              place: input.place,
              specialistName: input.specialistName,
            },
            now,
          )
      this.procedureDetails.set(details.id, details)
    }
  }

  async cancelOccurrence(command: CancelSelfCareOccurrenceCommand) {
    const occurrence = this.getOccurrence(command.context, command.occurrenceId)
    const completion = createCompletionRecord(
      {
        alternativeTitle: null,
        completedVariant: null,
        durationMinutes: null,
        energyAfter: null,
        energyBefore: null,
        measurementUnit: null,
        measurementValue: null,
        moodAfter: null,
        moodBefore: null,
        note: '',
        status: 'cancelled',
      },
      {
        itemId: occurrence.itemId,
        occurrence,
        userId: command.context.actorUserId,
      },
    )
    this.completions.set(completion.id, completion)
    const nextOccurrence = updateOccurrenceStatus(occurrence, 'cancelled')
    this.occurrences.set(nextOccurrence.id, nextOccurrence)
    return nextOccurrence
  }

  async getDailyState(context: SelfCareReadContext, date: string) {
    return (
      this.loadState(context).dailyStates.find(
        (state) => state.date === date,
      ) ?? null
    )
  }

  async upsertDailyState(command: UpsertSelfCareDailyStateCommand) {
    const stateKey = `${command.context.actorUserId}:${command.date}`
    const existing = this.dailyStates.get(stateKey)
    const next = existing
      ? {
          ...existing,
          ...command.input,
          date: command.date,
          updatedAt: new Date().toISOString(),
        }
      : createDailyStateRecord(command.date, command.input, {
          userId: command.context.actorUserId,
        })
    this.dailyStates.set(stateKey, next)
    return next
  }

  async getSettings(context: SelfCareReadContext) {
    const state = this.loadState(context)
    return { minimumItems: state.minimumItems, settings: state.settings }
  }

  async updateSettings(command: UpdateSelfCareSettingsCommand) {
    const settings = this.getOrCreateSettings(command.context)
    const next = {
      ...settings,
      ...(command.input.currency !== undefined
        ? { currency: command.input.currency }
        : {}),
      ...(command.input.showAppointmentsInCalendar !== undefined
        ? {
            showAppointmentsInCalendar:
              command.input.showAppointmentsInCalendar,
          }
        : {}),
      ...(command.input.showSelfCareInMainTasks !== undefined
        ? { showSelfCareInMainTasks: command.input.showSelfCareInMainTasks }
        : {}),
      updatedAt: new Date().toISOString(),
    }
    this.settings.set(settings.userId, next)
    return this.getSettings(command.context)
  }

  async enableGentleMode(command: ToggleSelfCareGentleModeCommand) {
    const settings = this.getOrCreateSettings(command.context)
    this.settings.set(settings.userId, {
      ...settings,
      gentleModeDate: command.date,
      gentleModeEnabledToday: true,
      updatedAt: new Date().toISOString(),
    })
    return this.getSettings(command.context)
  }

  async disableGentleMode(command: ToggleSelfCareGentleModeCommand) {
    const settings = this.getOrCreateSettings(command.context)
    this.settings.set(settings.userId, {
      ...settings,
      gentleModeDate: command.date,
      gentleModeEnabledToday: false,
      updatedAt: new Date().toISOString(),
    })
    return this.getSettings(command.context)
  }

  async updateMinimumItems(command: UpdateSelfCareMinimumItemsCommand) {
    for (const item of this.loadState(command.context).minimumItems) {
      this.minimumItems.delete(item.id)
    }
    command.input.items.forEach((item, index) => {
      const record = createMinimumItemRecord(item, {
        index,
        userId: command.context.actorUserId,
      })
      this.minimumItems.set(record.id, record)
    })
    return this.getSettings(command.context)
  }

  async updateRitualSteps(command: UpdateSelfCareRitualStepsCommand) {
    this.getWritableItem(command.context, command.itemId)
    this.deleteForItem(this.steps, command.itemId)
    this.deleteForItem(this.stepDrafts, command.itemId)
    command.steps.forEach((step, index) => {
      const record = createRitualStepRecord(command.itemId, step, index)
      this.steps.set(record.id, record)
    })
    return this.listItems(command.context)
  }

  async getRitualStepDrafts(command: GetSelfCareRitualStepDraftsCommand) {
    const userId =
      command.context.actorUserId ??
      this.findUserIdForWorkspace(command.context.workspaceId)

    return {
      date: command.date,
      drafts: [...this.stepDrafts.values()]
        .filter(
          (draft) =>
            draft.date === command.date &&
            draft.userId === userId &&
            draft.workspaceId === command.context.workspaceId,
        )
        .map((draft) => toPublicRitualStepDraft(draft)),
    }
  }

  async upsertRitualStepDraft(command: UpsertSelfCareRitualStepDraftCommand) {
    const item = this.getWritableItem(command.context, command.input.itemId)
    this.assertRitualStepDraftOccurrence(command)
    this.assertRitualStepDraftSteps(item.id, command.input.stepIds)

    const draft: StoredSelfCareRitualStepDraftRecord = {
      date: command.input.date,
      itemId: item.id,
      occurrenceId: command.input.occurrenceId,
      stepIds: [...new Set(command.input.stepIds)],
      userId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    }
    this.stepDrafts.set(getRitualStepDraftKey(draft), draft)

    return this.getRitualStepDrafts({
      context: command.context,
      date: command.input.date,
    })
  }

  async deleteRitualStepDraft(command: DeleteSelfCareRitualStepDraftCommand) {
    const item = this.getWritableItem(command.context, command.itemId)
    this.stepDrafts.delete(
      getRitualStepDraftKey({
        date: command.date,
        itemId: item.id,
        occurrenceId: command.occurrenceId,
        userId: command.context.actorUserId,
        workspaceId: command.context.workspaceId,
      }),
    )

    return this.getRitualStepDrafts({
      context: command.context,
      date: command.date,
    })
  }

  async getHistory(context: SelfCareReadContext, from: string, to: string) {
    return buildHistoryResponse({ from, state: this.loadState(context), to })
  }

  async getAnalytics(context: SelfCareReadContext, from: string, to: string) {
    return buildAnalyticsResponse({ from, state: this.loadState(context), to })
  }

  async listTemplates(context: SelfCareReadContext) {
    void context
    return this.templates
  }

  async createItemFromTemplate(command: CreateSelfCareItemFromTemplateCommand) {
    const template = this.templates.find(
      (candidate) => candidate.id === command.templateId,
    )
    if (!template) {
      throw new HttpError(
        404,
        'self_care_template_not_found',
        'Self-care template not found.',
      )
    }
    const input = buildItemInputFromTemplate(template, command.input.overrides)
    const records = createSelfCareRecords(input, {
      actorUserId: command.context.actorUserId,
      createdFromTemplateId: template.id,
      workspaceId: command.context.workspaceId,
    })
    this.storeCreatedRecords(records)
    return records.item
  }

  private setArchiveState(
    context: SelfCareWriteContext,
    itemId: string,
    isArchived: boolean,
  ) {
    const item = this.getWritableItem(context, itemId, {
      allowArchived: !isArchived,
    })
    const next = {
      ...item,
      isActive: isArchived ? false : true,
      isArchived,
      updatedAt: new Date().toISOString(),
      version: item.version + 1,
    }
    this.items.set(next.id, next)
    return Promise.resolve(next)
  }

  private storeCreatedRecords(
    records: ReturnType<typeof createSelfCareRecords>,
  ) {
    this.items.set(records.item.id, records.item)
    records.alternatives.forEach((record) =>
      this.alternatives.set(record.id, record),
    )
    records.steps.forEach((record) => this.steps.set(record.id, record))
    if (records.scheduleRule)
      this.scheduleRules.set(records.scheduleRule.id, records.scheduleRule)
    if (records.procedureDetails)
      this.procedureDetails.set(
        records.procedureDetails.id,
        records.procedureDetails,
      )
    if (records.appointmentDetails)
      this.appointmentDetails.set(
        records.appointmentDetails.id,
        records.appointmentDetails,
      )
    if (records.medicalDetails)
      this.medicalDetails.set(records.medicalDetails.id, records.medicalDetails)
    if (records.measurementDetails)
      this.measurementDetails.set(
        records.measurementDetails.id,
        records.measurementDetails,
      )
    if (records.courseDetails)
      this.courseDetails.set(records.courseDetails.id, records.courseDetails)
  }

  private loadState(context: SelfCareReadContext) {
    const userId =
      context.actorUserId ?? this.findUserIdForWorkspace(context.workspaceId)
    this.getOrCreateSettings({ ...context, actorUserId: userId })
    this.getOrCreateMinimumItems(userId)

    return {
      alternatives: [...this.alternatives.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      appointmentDetails: [...this.appointmentDetails.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      completions: [...this.completions.values()].filter(
        (item) => item.userId === userId,
      ),
      courseDetails: [...this.courseDetails.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      dailyStates: [...this.dailyStates.values()].filter(
        (item) => item.userId === userId,
      ),
      items: [...this.items.values()].filter(
        (item) =>
          item.userId === userId &&
          item.workspaceId === context.workspaceId &&
          item.deletedAt === null,
      ),
      medicalDetails: [...this.medicalDetails.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      measurementDetails: [...this.measurementDetails.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      minimumItems: [...this.minimumItems.values()]
        .filter((item) => item.userId === userId)
        .sort((left, right) => left.order - right.order),
      occurrences: [...this.occurrences.values()].filter(
        (item) => item.userId === userId,
      ),
      procedureDetails: [...this.procedureDetails.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      scheduleRules: [...this.scheduleRules.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      settings:
        this.settings.get(userId) ?? createDefaultSelfCareSettings({ userId }),
      stepCompletions: [...this.stepCompletions.values()],
      steps: [...this.steps.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
      ),
      templates: this.templates,
    }
  }

  private generateReadOccurrences(
    context: SelfCareReadContext,
    from: string,
    to: string,
  ) {
    const actorUserId =
      context.actorUserId ?? this.findUserIdForWorkspace(context.workspaceId)
    if (!actorUserId) return
    void this.generateOccurrences({
      context: { ...context, actorUserId },
      from,
      to,
    })
  }

  private markMissedOccurrences(context: SelfCareReadContext, date: string) {
    const state = this.loadState(context)
    const itemById = new Map(state.items.map((item) => [item.id, item]))

    for (const occurrence of state.occurrences) {
      const item = itemById.get(occurrence.itemId)

      if (
        item &&
        shouldMarkSelfCareOccurrenceMissed({ date, item, occurrence, state })
      ) {
        this.occurrences.set(
          occurrence.id,
          updateOccurrenceStatus(occurrence, 'missed'),
        )
      }
    }
  }

  private findScheduleRuleForItem(itemId: string): SelfCareScheduleRule | null {
    return (
      [...this.scheduleRules.values()].find((rule) => rule.itemId === itemId) ??
      null
    )
  }

  private relinkOpenOccurrencesToScheduleRule(rule: SelfCareScheduleRule) {
    for (const occurrence of this.occurrences.values()) {
      if (
        occurrence.itemId !== rule.itemId ||
        occurrence.scheduleRuleId !== null ||
        occurrence.completedAt !== null ||
        (occurrence.status !== 'scheduled' && occurrence.status !== 'missed')
      ) {
        continue
      }

      this.occurrences.set(occurrence.id, {
        ...occurrence,
        scheduleRuleId: rule.id,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  private findProgressCompletionForDate(input: {
    date: string
    itemId: string
    userId: string
  }): StoredSelfCareCompletionRecord | null {
    return (
      [...this.completions.values()]
        .filter(
          (completion) =>
            completion.userId === input.userId &&
            completion.itemId === input.itemId &&
            completion.completedAt.slice(0, 10) === input.date &&
            isCompletionProgressStatus(completion.status),
        )
        .sort((left, right) =>
          right.completedAt.localeCompare(left.completedAt),
        )[0] ?? null
    )
  }

  private getWritableItem(
    context: SelfCareWriteContext,
    itemId: string,
    options: { allowArchived?: boolean | undefined } = {},
  ) {
    const item = this.items.get(itemId)
    if (
      !item ||
      item.deletedAt !== null ||
      item.userId !== context.actorUserId ||
      item.workspaceId !== context.workspaceId
    ) {
      throw new HttpError(
        404,
        'self_care_item_not_found',
        'Self-care item not found.',
      )
    }
    if (item.isArchived && !options.allowArchived) {
      throw new HttpError(
        400,
        'self_care_item_archived',
        'Archived self-care item cannot be changed.',
      )
    }
    return item
  }

  private getOccurrence(context: SelfCareWriteContext, occurrenceId: string) {
    const occurrence = this.occurrences.get(occurrenceId)
    if (!occurrence || occurrence.userId !== context.actorUserId) {
      throw new HttpError(
        404,
        'self_care_occurrence_not_found',
        'Self-care occurrence not found.',
      )
    }
    return occurrence
  }

  private loadStepsForItem(itemId: string) {
    return [...this.steps.values()].filter((step) => step.itemId === itemId)
  }

  private assertRitualStepDraftOccurrence(
    command: UpsertSelfCareRitualStepDraftCommand,
  ): void {
    if (!command.input.occurrenceId) {
      return
    }

    const occurrence = this.getOccurrence(
      command.context,
      command.input.occurrenceId,
    )

    if (occurrence.itemId !== command.input.itemId) {
      throw new HttpError(
        400,
        'self_care_ritual_step_draft_occurrence_mismatch',
        'Self-care occurrence does not belong to this item.',
      )
    }
  }

  private assertRitualStepDraftSteps(itemId: string, stepIds: string[]): void {
    const availableStepIds = new Set(
      this.loadStepsForItem(itemId).map((step) => step.id),
    )
    const hasInvalidStep = stepIds.some(
      (stepId) => !availableStepIds.has(stepId),
    )

    if (hasInvalidStep) {
      throw new HttpError(
        400,
        'self_care_ritual_step_draft_invalid_step',
        'Self-care ritual step draft contains an unknown step.',
      )
    }
  }

  private deleteRitualStepDraftRecord(input: {
    date: string
    itemId: string
    occurrenceId: string | null
    userId: string
    workspaceId: string
  }): void {
    this.stepDrafts.delete(getRitualStepDraftKey(input))
  }

  private incrementCourseIfNeeded(itemId: string) {
    const course = [...this.courseDetails.values()].find(
      (details) => details.itemId === itemId,
    )
    if (!course || course.isCompleted) return
    const completedCount = Math.min(
      course.totalCount,
      course.completedCount + 1,
    )
    this.courseDetails.set(course.id, {
      ...course,
      completedCount,
      isCompleted: completedCount >= course.totalCount,
      updatedAt: new Date().toISOString(),
    })
  }

  private getOrCreateSettings(context: {
    actorUserId?: string | undefined
    workspaceId?: string | undefined
  }) {
    const userId =
      context.actorUserId ??
      (context.workspaceId
        ? this.findUserIdForWorkspace(context.workspaceId)
        : 'self-care-memory-user')
    const existing = this.settings.get(userId)
    if (existing) return existing
    const settings = createDefaultSelfCareSettings({ userId })
    this.settings.set(userId, settings)
    return settings
  }

  private getOrCreateMinimumItems(userId: string) {
    const existing = [...this.minimumItems.values()].filter(
      (item) => item.userId === userId,
    )
    if (existing.length > 0) return existing
    const items = createDefaultMinimumItems(userId)
    items.forEach((item) => this.minimumItems.set(item.id, item))
    return items
  }

  private findUserIdForWorkspace(workspaceId: string) {
    return (
      [...this.items.values()].find((item) => item.workspaceId === workspaceId)
        ?.userId ?? 'self-care-memory-user'
    )
  }

  private itemBelongsToUser(itemId: string, userId: string) {
    return this.items.get(itemId)?.userId === userId
  }

  private deleteForItem<T extends { itemId: string }>(
    map: Map<string, T>,
    itemId: string,
  ) {
    for (const [id, record] of map.entries()) {
      if (record.itemId === itemId) {
        map.delete(id)
      }
    }
  }
}

function getRitualStepDraftKey(input: {
  date: string
  itemId: string
  occurrenceId: string | null
  userId: string
  workspaceId: string
}): string {
  return [
    input.workspaceId,
    input.userId,
    input.date,
    input.itemId,
    input.occurrenceId ?? '',
  ].join(':')
}

function toPublicRitualStepDraft(draft: StoredSelfCareRitualStepDraftRecord) {
  return {
    date: draft.date,
    itemId: draft.itemId,
    occurrenceId: draft.occurrenceId,
    stepIds: draft.stepIds,
  }
}

function mapCompletionStatusToOccurrenceStatus(
  status: StoredSelfCareCompletionRecord['status'],
): StoredSelfCareOccurrenceRecord['status'] {
  if (status === 'alternative_done') return 'partial'
  return status
}

function isSameScheduleSlot(
  occurrence: StoredSelfCareOccurrenceRecord,
  scheduleRule: SelfCareScheduleRule | null,
): boolean {
  if (!scheduleRule) {
    return occurrence.scheduleRuleId === null
  }

  if (occurrence.scheduleRuleId === scheduleRule.id) {
    return true
  }

  return !scheduleRule.allowMultiplePerDay && occurrence.scheduleRuleId === null
}

function assertMeasurementCompletionInput(
  item: StoredSelfCareItemRecord,
  input: CompleteSelfCareItemNowCommand['input'],
): void {
  if (item.type !== 'measurement') {
    return
  }

  if (input.measurementValue === null || input.measurementValue === undefined) {
    throw new HttpError(
      400,
      'self_care_measurement_value_required',
      'Measurement value is required.',
    )
  }
}

function assertMoodCheckCompletionInput(
  item: StoredSelfCareItemRecord,
  input: CompleteSelfCareItemNowCommand['input'],
): void {
  if (item.type !== 'mood_check') {
    return
  }

  if (
    (input.moodAfter === null || input.moodAfter === undefined) &&
    (input.energyAfter === null || input.energyAfter === undefined)
  ) {
    throw new HttpError(
      400,
      'self_care_state_value_required',
      'Mood or energy value is required.',
    )
  }
}

function hasScheduleDetails(
  input: ScheduleSelfCareItemCommand['input'],
): boolean {
  return Boolean(
    input.place?.trim() ||
    input.specialistName?.trim() ||
    input.specialistContact?.trim() ||
    input.currency?.trim() ||
    input.note?.trim() ||
    input.price !== null,
  )
}

function shouldStoreAppointmentDetails(
  item: StoredSelfCareItemRecord,
  input: ScheduleSelfCareItemCommand['input'],
): boolean {
  return (
    item.type === 'appointment' ||
    Boolean(input.scheduledTime) ||
    hasScheduleDetails(input)
  )
}

function buildScheduleDetailsStartsAt(scheduledFor: string): string {
  return `${scheduledFor}T00:00:00.000Z`
}
