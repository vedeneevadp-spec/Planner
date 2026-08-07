/* eslint-disable @typescript-eslint/require-await */
import {
  getDateKeyInTimeZone,
  type SelfCareAppointmentDetails,
  type SelfCareCompletion,
  type SelfCareCourseDetails,
  type SelfCareExerciseDetails,
  type SelfCareItemAlternative,
  type SelfCareMeasurementDetails,
  type SelfCareMedicalDetails,
  type SelfCareMinimumItem,
  selfCareOfflineCommandResultSchema,
  type SelfCareProcedureDetails,
  type SelfCareRitualStep,
  type SelfCareRitualStepCompletion,
  type SelfCareScheduleRule,
  type SelfCareSettings,
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
  ExecuteSelfCareOfflineCommand,
  ExecuteSelfCareOfflineCommandResult,
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
  UpdateSelfCareCompletionCommand,
  UpdateSelfCareItemCommand,
  UpdateSelfCareMinimumItemsCommand,
  UpdateSelfCareRitualStepsCommand,
  UpdateSelfCareSettingsCommand,
  UpsertSelfCareDailyStateCommand,
  UpsertSelfCareRitualStepDraftCommand,
} from './self-care.model.js'
import {
  dispatchSelfCareOfflineCommand,
  fingerprintSelfCareCommandRequest,
} from './self-care.offline-command.js'
import type { SelfCareRepository } from './self-care.repository.js'
import {
  addDays,
  buildAnalyticsResponse,
  buildDashboardResponse,
  buildHistoryResponse,
  buildItemInputFromTemplate,
  buildPlanResponse,
  buildSelfCareDueAtInstant,
  buildSelfCareListResponse,
  buildSystemSelfCareTemplates,
  createAppointmentDetailsRecord,
  createCompletionRecord,
  createCourseDetailsRecord,
  createDailyStateRecord,
  createDefaultMinimumItems,
  createDefaultSelfCareSettings,
  createExerciseDetailsRecord,
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
  shouldDeactivateCompletedFlexibleGoal,
  shouldDeduplicateSelfCareItemCompletion,
  updateOccurrenceStatus,
} from './self-care.shared.js'

export class MemorySelfCareRepository implements SelfCareRepository {
  private commandExecution = Promise.resolve()
  private readonly commandLedger = new Map<
    string,
    {
      fingerprint: string
      result: ExecuteSelfCareOfflineCommandResult['result']
    }
  >()
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
  private readonly exerciseDetails = new Map<string, SelfCareExerciseDetails>()
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

  executeOfflineCommand(command: ExecuteSelfCareOfflineCommand) {
    const execution = this.commandExecution.then(() =>
      this.executeOfflineCommandSerialized(command),
    )
    this.commandExecution = execution.then(
      () => undefined,
      () => undefined,
    )
    return execution
  }

  async listItems(
    context: SelfCareReadContext,
    filters: SelfCareListFilters = {},
  ) {
    return buildSelfCareListResponse(this.loadState(context), filters)
  }

  async createItem(command: CreateSelfCareItemCommand) {
    const records = createSelfCareRecords(command.input, {
      actorUserId: command.context.actorUserId,
      clientTimeZone: command.context.clientTimeZone,
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
        'self_care_version_conflict',
        'Self-care item was changed on the server.',
        {
          actualVersion: item.version,
          entityId: item.id,
          entityType: 'item',
          expectedVersion: command.input.expectedVersion,
        },
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
    const existingRule = command.input.scheduleRule
      ? ([...this.scheduleRules.values()].find(
          (candidate) => candidate.itemId === nextItem.id,
        ) ?? null)
      : null
    const nextRule = command.input.scheduleRule
      ? createScheduleRuleRecord(
          nextItem.id,
          {
            ...command.input.scheduleRule,
            id: existingRule?.id ?? command.input.scheduleRule.id,
          },
          now,
        )
      : null
    const nextSteps = command.input.steps
      ? command.input.steps.map((step, index) =>
          createRitualStepRecord(nextItem.id, step, index, now),
        )
      : null
    const nextAlternatives = command.input.alternatives
      ? command.input.alternatives.map((alternative) => ({
          countsAsCompletion: alternative.countsAsCompletion,
          description: alternative.description,
          id: alternative.id ?? `${nextItem.id}-${alternative.title}`,
          itemId: nextItem.id,
          title: alternative.title,
        }))
      : null

    if (nextRule) {
      assertChildRecordIdsAvailable(
        this.scheduleRules,
        [nextRule],
        nextItem.id,
        true,
      )
    }
    if (nextSteps) {
      assertChildRecordIdsAvailable(this.steps, nextSteps, nextItem.id, true)
    }
    if (nextAlternatives) {
      assertChildRecordIdsAvailable(
        this.alternatives,
        nextAlternatives,
        nextItem.id,
        true,
      )
    }

    this.items.set(nextItem.id, nextItem)

    if (nextRule) {
      this.scheduleRules.set(nextRule.id, nextRule)
      this.relinkOpenOccurrencesToScheduleRule(nextRule)
    }

    if (nextSteps) {
      this.deleteForItem(this.steps, nextItem.id)
      this.deleteForItem(this.stepDrafts, nextItem.id)
      nextSteps.forEach((record) => {
        this.steps.set(record.id, record)
      })
    }

    if (nextAlternatives) {
      this.deleteForItem(this.alternatives, nextItem.id)
      nextAlternatives.forEach((record) => {
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

    if (command.input.exerciseDetails) {
      this.deleteForItem(this.exerciseDetails, nextItem.id)
      const record = createExerciseDetailsRecord(
        nextItem.id,
        command.input.exerciseDetails,
        now,
      )
      this.exerciseDetails.set(record.id, record)
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
    return this.setArchiveState(
      command.context,
      command.itemId,
      true,
      command.expectedVersion,
    )
  }

  async restoreItem(command: RestoreSelfCareItemCommand) {
    return this.setArchiveState(
      command.context,
      command.itemId,
      false,
      command.expectedVersion,
    )
  }

  async deleteItem(command: DeleteSelfCareItemCommand) {
    const item = this.getWritableItem(command.context, command.itemId)
    assertSelfCareVersion(
      'item',
      item.id,
      command.expectedVersion,
      item.version,
    )
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
    return buildDashboardResponse({
      date: command.date,
      state: this.loadState(command.context),
    })
  }

  async getPlan(command: GetSelfCarePlanCommand) {
    this.generateReadOccurrences(command.context, command.from, command.to)
    return buildPlanResponse({
      from: command.from,
      state: this.loadState(command.context),
      to: command.to,
    })
  }

  async getOccurrences(command: GetSelfCareOccurrencesCommand) {
    this.generateReadOccurrences(command.context, command.from, command.to)
    return this.loadState(command.context).occurrences.filter(
      (occurrence) =>
        occurrence.scheduledFor >= command.from &&
        occurrence.scheduledFor <= command.to,
    )
  }

  async completeOccurrence(command: CompleteSelfCareOccurrenceCommand) {
    const occurrence = this.getOccurrence(command.context, command.occurrenceId)
    assertSelfCareVersion(
      'occurrence',
      occurrence.id,
      command.expectedVersion,
      occurrence.version,
    )
    assertSelfCareOccurrenceOpen(occurrence)
    this.assertCompletionIdAvailable(command.completionId)
    const item = this.getWritableItem(command.context, occurrence.itemId)
    assertExerciseCompletionInput(item, command.input)
    assertMeasurementCompletionInput(item, command.input)
    assertMoodCheckCompletionInput(item, command.input)
    const steps = this.loadStepsForItem(item.id)
    assertRitualCompletionSteps(item.id, steps, command.input.steps)
    const stepCompletions = createRitualStepCompletions(
      'pending',
      command.input,
    )
    const status = inferRitualCompletionStatus({
      requestedStatus: command.input.status,
      stepCompletions,
      steps,
    })
    const completion = createCompletionRecord(
      { ...command.input, status },
      {
        completionId: command.completionId,
        itemId: item.id,
        occurrence,
        userId: command.context.actorUserId,
      },
    )
    const exerciseProgressCompletion =
      item.type === 'exercise'
        ? this.updateOpenExerciseProgressCompletion({
            completion,
            date: getSelfCareCompletionDateKey(
              command.input,
              command.context.clientTimeZone,
            ),
            itemId: item.id,
            plannerTimeZone: command.context.clientTimeZone,
            userId: command.context.actorUserId,
          })
        : null
    const finalStepCompletions = stepCompletions.map((step) => ({
      ...step,
      completionId: completion.id,
    }))

    const storedCompletion = exerciseProgressCompletion ?? completion

    if (!exerciseProgressCompletion) {
      this.completions.set(completion.id, completion)
      finalStepCompletions.forEach((step) =>
        this.stepCompletions.set(step.id, step),
      )
    }
    this.occurrences.set(
      occurrence.id,
      updateOccurrenceStatus(
        occurrence,
        mapCompletionStatusToOccurrenceStatus(status),
        {
          completedAt: storedCompletion.completedAt,
        },
      ),
    )
    this.deleteRitualStepDraftRecord({
      date: getSelfCareCompletionDateKey(
        command.input,
        command.context.clientTimeZone,
      ),
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
    this.incrementCourseIfNeeded(
      item.id,
      getDateKeyInTimeZone(
        completion.completedAt,
        command.context.clientTimeZone ?? 'UTC',
      ),
    )

    return storedCompletion
  }

  async completeItemNow(command: CompleteSelfCareItemNowCommand) {
    const item = this.getWritableItem(command.context, command.itemId)
    assertSelfCareVersion(
      'item',
      item.id,
      command.expectedVersion,
      item.version,
    )
    assertExerciseCompletionInput(item, command.input)
    assertMeasurementCompletionInput(item, command.input)
    assertMoodCheckCompletionInput(item, command.input)
    const steps = this.loadStepsForItem(item.id)
    assertRitualCompletionSteps(item.id, steps, command.input.steps)
    const scheduleRule = this.findScheduleRuleForItem(item.id)
    const completionDate = getSelfCareCompletionDateKey(
      command.input,
      command.context.clientTimeZone,
    )
    const existingCompletion = shouldDeduplicateSelfCareItemCompletion({
      item,
      scheduleRule,
    })
      ? this.findProgressCompletionForDate({
          date: completionDate,
          itemId: item.id,
          plannerTimeZone: command.context.clientTimeZone,
          userId: command.context.actorUserId,
        })
      : null

    if (existingCompletion) {
      this.deleteRitualStepDraftRecord({
        date: completionDate,
        itemId: item.id,
        occurrenceId: null,
        userId: command.context.actorUserId,
        workspaceId: command.context.workspaceId,
      })
      this.items.set(item.id, {
        ...item,
        updatedAt: new Date().toISOString(),
        version: item.version + 1,
      })
      return existingCompletion
    }

    this.assertCompletionIdAvailable(command.completionId)

    const pendingStepCompletions = createRitualStepCompletions(
      'pending',
      command.input,
    )
    const status = inferRitualCompletionStatus({
      requestedStatus: command.input.status,
      stepCompletions: pendingStepCompletions,
      steps,
    })
    const completion = createCompletionRecord(
      { ...command.input, status },
      {
        completionId: command.completionId,
        itemId: item.id,
        scheduledFor: completionDate,
        userId: command.context.actorUserId,
      },
    )
    const exerciseProgressCompletion =
      item.type === 'exercise'
        ? this.updateOpenExerciseProgressCompletion({
            completion,
            date: completionDate,
            itemId: item.id,
            plannerTimeZone: command.context.clientTimeZone,
            userId: command.context.actorUserId,
          })
        : null
    const finalStepCompletions = pendingStepCompletions.map((step) => ({
      ...step,
      completionId: completion.id,
    }))

    const storedCompletion = exerciseProgressCompletion ?? completion

    if (!exerciseProgressCompletion) {
      this.completions.set(completion.id, completion)
      finalStepCompletions.forEach((step) =>
        this.stepCompletions.set(step.id, step),
      )
    }
    this.deleteRitualStepDraftRecord({
      date: completionDate,
      itemId: item.id,
      occurrenceId: null,
      userId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })
    this.incrementCourseIfNeeded(item.id, completionDate)
    const currentItem = this.items.get(item.id) ?? item
    this.items.set(item.id, {
      ...currentItem,
      updatedAt: new Date().toISOString(),
      version: item.version + 1,
    })
    return storedCompletion
  }

  async completeFlexibleGoal(command: CompleteFlexibleGoalCommand) {
    const completion = await this.completeItemNow({
      completionId: command.completionId,
      context: command.context,
      expectedVersion: command.expectedVersion,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })

    this.deactivateFlexibleGoalIfCompleted(
      command.context,
      command.itemId,
      completion,
    )

    return completion
  }

  async completeCourseSession(command: CompleteCourseSessionCommand) {
    return this.completeItemNow({
      completionId: command.completionId,
      context: command.context,
      expectedVersion: command.expectedVersion,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })
  }

  async updateCompletion(command: UpdateSelfCareCompletionCommand) {
    const current = this.completions.get(command.completionId)
    if (!current || current.userId !== command.context.actorUserId) {
      throw new HttpError(
        404,
        'self_care_completion_not_found',
        'Self-care completion not found.',
      )
    }

    const item = this.getWritableItem(command.context, current.itemId, {
      allowArchived: true,
    })
    assertSelfCareVersion(
      'completion',
      current.id,
      command.expectedVersion,
      current.version,
    )
    const next: StoredSelfCareCompletionRecord = {
      ...current,
      ...(command.input.alternativeTitle !== undefined
        ? { alternativeTitle: command.input.alternativeTitle }
        : {}),
      ...(command.input.completedVariant !== undefined
        ? { completedVariant: command.input.completedVariant }
        : {}),
      ...(command.input.currency !== undefined
        ? { currency: command.input.currency }
        : {}),
      ...(command.input.durationMinutes !== undefined
        ? { durationMinutes: command.input.durationMinutes }
        : {}),
      ...(command.input.energyAfter !== undefined
        ? { energyAfter: command.input.energyAfter }
        : {}),
      ...(command.input.energyBefore !== undefined
        ? { energyBefore: command.input.energyBefore }
        : {}),
      ...(command.input.exerciseSets !== undefined
        ? { exerciseSets: command.input.exerciseSets }
        : {}),
      ...(command.input.measurementUnit !== undefined
        ? { measurementUnit: command.input.measurementUnit }
        : {}),
      ...(command.input.measurementValue !== undefined
        ? { measurementValue: command.input.measurementValue }
        : {}),
      ...(command.input.moodAfter !== undefined
        ? { moodAfter: command.input.moodAfter }
        : {}),
      ...(command.input.moodBefore !== undefined
        ? { moodBefore: command.input.moodBefore }
        : {}),
      ...(command.input.note !== undefined ? { note: command.input.note } : {}),
      ...(command.input.price !== undefined
        ? { price: command.input.price }
        : {}),
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    }

    assertExerciseCompletionInput(item, { ...next, steps: [] })
    assertMeasurementCompletionInput(item, { ...next, steps: [] })
    assertMoodCheckCompletionInput(item, { ...next, steps: [] })

    this.completions.set(next.id, next)
    return next
  }

  async skipOccurrence(command: SkipSelfCareOccurrenceCommand) {
    const occurrence = this.getOccurrence(command.context, command.occurrenceId)
    assertSelfCareVersion(
      'occurrence',
      occurrence.id,
      command.expectedVersion,
      occurrence.version,
    )
    assertSelfCareOccurrenceOpen(occurrence)
    this.assertCompletionIdAvailable(command.completionId)
    const completion = createCompletionRecord(
      {
        alternativeTitle: null,
        completedVariant: null,
        currency: null,
        durationMinutes: null,
        energyAfter: null,
        energyBefore: null,
        exerciseSets: [],
        measurementUnit: null,
        measurementValue: null,
        moodAfter: null,
        moodBefore: null,
        note: command.input.reason,
        price: null,
        status: 'skipped',
        ...(command.actedAt ? { completedAt: command.actedAt } : {}),
      },
      {
        completionId: command.completionId,
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
    if (
      command.expectedItemId !== undefined &&
      occurrence.itemId !== command.expectedItemId
    ) {
      throw new HttpError(
        409,
        'self_care_reschedule_item_conflict',
        'The occurrence selected for rescheduling belongs to another self-care item.',
      )
    }
    assertSelfCareVersion(
      'occurrence',
      occurrence.id,
      command.expectedVersion,
      occurrence.version,
    )
    assertSelfCareOccurrenceOpen(occurrence)
    this.assertCompletionIdAvailable(command.completionId)
    const completion = createCompletionRecord(
      {
        alternativeTitle: null,
        completedVariant: null,
        currency: null,
        durationMinutes: null,
        energyAfter: null,
        energyBefore: null,
        exerciseSets: [],
        measurementUnit: null,
        measurementValue: null,
        moodAfter: null,
        moodBefore: null,
        note: command.input.note,
        price: null,
        status: 'moved',
        ...(command.actedAt ? { completedAt: command.actedAt } : {}),
      },
      {
        completionId: command.completionId,
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
    assertSelfCareVersion(
      'item',
      item.id,
      command.expectedVersion,
      item.version,
    )
    const scheduleRule =
      [...this.scheduleRules.values()].find(
        (candidate) => candidate.itemId === item.id,
      ) ?? null
    const scheduledTime = command.input.scheduledTime ?? null
    const reminderTimeZone =
      command.input.timezone ??
      scheduleRule?.timezone ??
      command.context.clientTimeZone ??
      null
    const dueAt = buildSelfCareDueAtInstant(
      command.input.scheduledFor,
      scheduledTime ?? scheduleRule?.preferredTime ?? null,
      reminderTimeZone,
    )

    if (
      (command.existingOccurrenceId === undefined) !==
      (command.expectedOccurrenceVersion === undefined)
    ) {
      throw new HttpError(
        400,
        'self_care_schedule_update_invalid',
        'Existing occurrence id and version must be provided together.',
      )
    }

    if (
      command.existingOccurrenceId !== undefined &&
      command.expectedOccurrenceVersion !== undefined
    ) {
      const existing = this.getOccurrence(
        command.context,
        command.existingOccurrenceId,
      )

      if (existing.itemId !== item.id) {
        throw new HttpError(
          404,
          'self_care_occurrence_not_found',
          'Self-care occurrence not found.',
        )
      }
      assertSelfCareVersion(
        'occurrence',
        existing.id,
        command.expectedOccurrenceVersion,
        existing.version,
      )
      assertSelfCareOccurrenceOpen(existing)
      if (existing.scheduledFor !== command.input.scheduledFor) {
        throw new HttpError(
          409,
          'self_care_schedule_date_conflict',
          'An in-place schedule update must keep the existing date.',
          {
            actualScheduledFor: existing.scheduledFor,
            entityId: existing.id,
            entityType: 'occurrence',
            requestedScheduledFor: command.input.scheduledFor,
          },
        )
      }

      const nextOccurrence = {
        ...existing,
        completedAt: null,
        dueAt,
        movedTo: null,
        reminderOffsetsMinutes: command.input.reminderOffsetsMinutes,
        reminderTimeZone,
        status: 'scheduled' as const,
        updatedAt: new Date().toISOString(),
        version: existing.version + 1,
      }
      this.occurrences.set(nextOccurrence.id, nextOccurrence)
      this.upsertScheduledDetails(item, nextOccurrence, command.input)
      return nextOccurrence
    }

    const existing = [...this.occurrences.values()].find(
      (occurrence) =>
        occurrence.itemId === item.id &&
        isSameScheduleSlot(occurrence, scheduleRule) &&
        occurrence.scheduledFor === command.input.scheduledFor,
    )

    if (existing) {
      if (command.strictInsert) {
        throw new HttpError(
          409,
          'self_care_schedule_slot_conflict',
          'A self-care occurrence already exists for this schedule slot.',
          {
            actualVersion: existing.version,
            entityId: existing.id,
            entityType: 'occurrence',
          },
        )
      }
      const nextOccurrence = {
        ...existing,
        completedAt: null,
        dueAt,
        movedTo: null,
        reminderOffsetsMinutes: command.input.reminderOffsetsMinutes,
        reminderTimeZone,
        scheduleRuleId: scheduleRule?.id ?? null,
        status: 'scheduled' as const,
        updatedAt: new Date().toISOString(),
        version: existing.version + 1,
      }
      this.occurrences.set(nextOccurrence.id, nextOccurrence)
      this.upsertScheduledDetails(item, nextOccurrence, command.input)
      return nextOccurrence
    }

    if (command.occurrenceId && this.occurrences.has(command.occurrenceId)) {
      throw new HttpError(
        409,
        'self_care_occurrence_id_conflict',
        'The self-care occurrence identifier is already in use.',
      )
    }

    const occurrence = createOccurrenceRecord({
      dueAt,
      item,
      occurrenceId: command.occurrenceId,
      scheduledFor: command.input.scheduledFor,
      scheduleRule,
    })
    occurrence.reminderOffsetsMinutes = command.input.reminderOffsetsMinutes
    occurrence.reminderTimeZone = reminderTimeZone
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
    assertSelfCareVersion(
      'occurrence',
      occurrence.id,
      command.expectedVersion,
      occurrence.version,
    )
    assertSelfCareOccurrenceOpen(occurrence)
    this.assertCompletionIdAvailable(command.completionId)
    const completion = createCompletionRecord(
      {
        alternativeTitle: null,
        completedVariant: null,
        currency: null,
        durationMinutes: null,
        energyAfter: null,
        energyBefore: null,
        exerciseSets: [],
        measurementUnit: null,
        measurementValue: null,
        moodAfter: null,
        moodBefore: null,
        note: '',
        price: null,
        status: 'cancelled',
        ...(command.actedAt ? { completedAt: command.actedAt } : {}),
      },
      {
        completionId: command.completionId,
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
    assertSelfCareVersion(
      'daily_state',
      existing?.id ?? stateKey,
      command.expectedVersion,
      existing?.version ?? null,
    )
    const next = existing
      ? {
          ...existing,
          ...command.input,
          date: command.date,
          updatedAt: new Date().toISOString(),
          version: existing.version + 1,
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
    assertSelfCareVersion(
      'settings',
      settings.id,
      command.expectedVersion,
      settings.version,
    )
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
      version: settings.version + 1,
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
      version: settings.version + 1,
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
      version: settings.version + 1,
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

    const draftKey = getRitualStepDraftKey({
      date: command.input.date,
      itemId: item.id,
      occurrenceId: command.input.occurrenceId,
      userId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })
    const existing = this.stepDrafts.get(draftKey)
    assertSelfCareVersion(
      'ritual_step_draft',
      draftKey,
      command.expectedVersion,
      existing?.version ?? null,
    )

    const draft: StoredSelfCareRitualStepDraftRecord = {
      date: command.input.date,
      itemId: item.id,
      occurrenceId: command.input.occurrenceId,
      stepIds: [...new Set(command.input.stepIds)],
      userId: command.context.actorUserId,
      version: existing ? existing.version + 1 : 1,
      workspaceId: command.context.workspaceId,
    }
    this.stepDrafts.set(draftKey, draft)

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
    this.generateReadOccurrences(context, from, to)
    return buildHistoryResponse({ from, state: this.loadState(context), to })
  }

  async getAnalytics(context: SelfCareReadContext, from: string, to: string) {
    this.generateReadOccurrences(context, from, to)
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
    const input = buildItemInputFromTemplate(
      template,
      command.input.overrides,
      {
        plannerTimeZone: command.context.clientTimeZone,
      },
    )
    const records = createSelfCareRecords(input, {
      actorUserId: command.context.actorUserId,
      clientTimeZone: command.context.clientTimeZone,
      createdFromTemplateId: template.id,
      workspaceId: command.context.workspaceId,
    })
    this.storeCreatedRecords(records)
    return records.item
  }

  private async executeOfflineCommandSerialized(
    command: ExecuteSelfCareOfflineCommand,
  ): Promise<ExecuteSelfCareOfflineCommandResult> {
    const ledgerKey = [
      command.context.workspaceId,
      command.context.actorUserId,
      command.request.operationId,
    ].join(':')
    const fingerprint = fingerprintSelfCareCommandRequest(command.request)
    const existing = this.commandLedger.get(ledgerKey)

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HttpError(
          409,
          'self_care_operation_id_reused',
          'The self-care operation identifier was already used for a different command.',
        )
      }

      return {
        operationId: command.request.operationId,
        replayed: true,
        result: existing.result,
      }
    }

    const snapshot = {
      alternatives: new Map(this.alternatives),
      appointmentDetails: new Map(this.appointmentDetails),
      completions: new Map(this.completions),
      courseDetails: new Map(this.courseDetails),
      dailyStates: new Map(this.dailyStates),
      exerciseDetails: new Map(this.exerciseDetails),
      items: new Map(this.items),
      medicalDetails: new Map(this.medicalDetails),
      measurementDetails: new Map(this.measurementDetails),
      minimumItems: new Map(this.minimumItems),
      occurrences: new Map(this.occurrences),
      procedureDetails: new Map(this.procedureDetails),
      scheduleRules: new Map(this.scheduleRules),
      settings: new Map(this.settings),
      stepCompletions: new Map(this.stepCompletions),
      stepDrafts: new Map(this.stepDrafts),
      steps: new Map(this.steps),
    }

    try {
      const result = selfCareOfflineCommandResultSchema.parse(
        await dispatchSelfCareOfflineCommand(
          this,
          command.context,
          command.dispatchCommand ?? command.request.command,
        ),
      )
      this.commandLedger.set(ledgerKey, { fingerprint, result })
      return {
        operationId: command.request.operationId,
        replayed: false,
        result,
      }
    } catch (error) {
      restoreMap(this.alternatives, snapshot.alternatives)
      restoreMap(this.appointmentDetails, snapshot.appointmentDetails)
      restoreMap(this.completions, snapshot.completions)
      restoreMap(this.courseDetails, snapshot.courseDetails)
      restoreMap(this.dailyStates, snapshot.dailyStates)
      restoreMap(this.exerciseDetails, snapshot.exerciseDetails)
      restoreMap(this.items, snapshot.items)
      restoreMap(this.medicalDetails, snapshot.medicalDetails)
      restoreMap(this.measurementDetails, snapshot.measurementDetails)
      restoreMap(this.minimumItems, snapshot.minimumItems)
      restoreMap(this.occurrences, snapshot.occurrences)
      restoreMap(this.procedureDetails, snapshot.procedureDetails)
      restoreMap(this.scheduleRules, snapshot.scheduleRules)
      restoreMap(this.settings, snapshot.settings)
      restoreMap(this.stepCompletions, snapshot.stepCompletions)
      restoreMap(this.stepDrafts, snapshot.stepDrafts)
      restoreMap(this.steps, snapshot.steps)
      throw error
    }
  }

  private setArchiveState(
    context: SelfCareWriteContext,
    itemId: string,
    isArchived: boolean,
    expectedVersion?: number,
  ) {
    const item = this.getWritableItem(context, itemId, {
      allowArchived: !isArchived,
    })
    assertSelfCareVersion('item', item.id, expectedVersion, item.version)
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
    if (this.items.has(records.item.id)) {
      throw new HttpError(
        409,
        'self_care_item_id_conflict',
        'The self-care item identifier is already in use.',
      )
    }

    assertChildRecordIdsAvailable(
      this.alternatives,
      records.alternatives,
      records.item.id,
    )
    assertChildRecordIdsAvailable(this.steps, records.steps, records.item.id)
    if (records.scheduleRule) {
      assertChildRecordIdsAvailable(
        this.scheduleRules,
        [records.scheduleRule],
        records.item.id,
      )
    }
    for (const [recordsById, record] of [
      [this.procedureDetails, records.procedureDetails],
      [this.appointmentDetails, records.appointmentDetails],
      [this.medicalDetails, records.medicalDetails],
      [this.measurementDetails, records.measurementDetails],
      [this.exerciseDetails, records.exerciseDetails],
      [this.courseDetails, records.courseDetails],
    ] as const) {
      if (record) {
        assertChildRecordIdsAvailable(
          recordsById as Map<string, typeof record>,
          [record],
          records.item.id,
        )
      }
    }

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
    if (records.exerciseDetails)
      this.exerciseDetails.set(
        records.exerciseDetails.id,
        records.exerciseDetails,
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
      exerciseDetails: [...this.exerciseDetails.values()].filter((item) =>
        this.itemBelongsToUser(item.itemId, userId),
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
    plannerTimeZone?: string | undefined
    userId: string
  }): StoredSelfCareCompletionRecord | null {
    const plannerTimeZone = input.plannerTimeZone ?? 'UTC'

    return (
      [...this.completions.values()]
        .filter(
          (completion) =>
            completion.userId === input.userId &&
            completion.itemId === input.itemId &&
            getDateKeyInTimeZone(completion.completedAt, plannerTimeZone) ===
              input.date &&
            isCompletionProgressStatus(completion.status),
        )
        .sort((left, right) =>
          right.completedAt.localeCompare(left.completedAt),
        )[0] ?? null
    )
  }

  private updateOpenExerciseProgressCompletion(input: {
    completion: StoredSelfCareCompletionRecord
    date: string
    itemId: string
    plannerTimeZone?: string | undefined
    userId: string
  }): StoredSelfCareCompletionRecord | null {
    const existingCompletion = this.findProgressCompletionForDate({
      date: input.date,
      itemId: input.itemId,
      plannerTimeZone: input.plannerTimeZone,
      userId: input.userId,
    })

    if (!existingCompletion || existingCompletion.status !== 'partial') {
      return null
    }

    const completion = {
      ...input.completion,
      createdAt: existingCompletion.createdAt,
      id: existingCompletion.id,
      updatedAt: input.completion.updatedAt,
      version: existingCompletion.version + 1,
    }

    this.completions.set(existingCompletion.id, completion)
    return completion
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

  private assertCompletionIdAvailable(completionId?: string): void {
    if (!completionId || !this.completions.has(completionId)) {
      return
    }

    throw new HttpError(
      409,
      'self_care_completion_id_conflict',
      'The self-care completion identifier is already in use.',
    )
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

  private incrementCourseIfNeeded(itemId: string, completionDate: string) {
    const course = [...this.courseDetails.values()].find(
      (details) => details.itemId === itemId,
    )
    if (!course || course.isCompleted) return
    const completedCount = Math.min(
      course.totalCount,
      course.completedCount + 1,
    )
    const isCompleted = completedCount >= course.totalCount

    if (isCompleted && course.repeatAfterCompletion) {
      const nextStartDate = addDays(completionDate, course.breakDays + 1)
      this.courseDetails.set(course.id, {
        ...course,
        completedCount: 0,
        endDate: null,
        isCompleted: false,
        startDate: nextStartDate,
        updatedAt: new Date().toISOString(),
      })
      this.moveCourseScheduleStartDate(itemId, nextStartDate)
      return
    }

    this.courseDetails.set(course.id, {
      ...course,
      completedCount,
      isCompleted,
      updatedAt: new Date().toISOString(),
    })
  }

  private deactivateFlexibleGoalIfCompleted(
    context: SelfCareWriteContext,
    itemId: string,
    completion: SelfCareCompletion,
  ): void {
    const item = this.items.get(itemId)
    const scheduleRule = this.findScheduleRuleForItem(itemId)

    if (
      !item ||
      !shouldDeactivateCompletedFlexibleGoal({
        completion,
        completions: [...this.completions.values()].filter(
          (candidate) => candidate.userId === context.actorUserId,
        ),
        item,
        scheduleRule,
      })
    ) {
      return
    }

    this.items.set(item.id, {
      ...item,
      isActive: false,
      updatedAt: new Date().toISOString(),
      version: item.version,
    })
  }

  private moveCourseScheduleStartDate(itemId: string, startDate: string): void {
    const rule = this.findScheduleRuleForItem(itemId)

    if (!rule || rule.repeatKind !== 'course') {
      return
    }

    this.scheduleRules.set(rule.id, {
      ...rule,
      startDate,
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
    version: draft.version,
  }
}

function mapCompletionStatusToOccurrenceStatus(
  status: StoredSelfCareCompletionRecord['status'],
): StoredSelfCareOccurrenceRecord['status'] {
  if (status === 'alternative_done') return 'partial'
  return status
}

function assertSelfCareVersion(
  entityType: string,
  entityId: string,
  expectedVersion: number | null | undefined,
  actualVersion: number | null,
): void {
  if (expectedVersion === undefined || expectedVersion === actualVersion) {
    return
  }

  throw new HttpError(
    409,
    'self_care_version_conflict',
    'Self-care data was changed on the server.',
    { actualVersion, entityId, entityType, expectedVersion },
  )
}

function assertSelfCareOccurrenceOpen(
  occurrence: StoredSelfCareOccurrenceRecord,
): void {
  if (occurrence.status === 'scheduled' || occurrence.status === 'missed') {
    return
  }

  throw new HttpError(
    409,
    'self_care_occurrence_closed',
    'The self-care occurrence was already completed or changed.',
    {
      actualVersion: occurrence.version,
      entityId: occurrence.id,
      entityType: 'occurrence',
    },
  )
}

function assertRitualCompletionSteps(
  itemId: string,
  availableSteps: readonly Pick<SelfCareRitualStep, 'id'>[],
  submittedSteps: readonly { stepId: string }[],
): void {
  const availableStepIds = new Set(availableSteps.map((step) => step.id))
  const submittedStepIds = submittedSteps.map((step) => step.stepId)

  if (new Set(submittedStepIds).size !== submittedStepIds.length) {
    throw new HttpError(
      400,
      'self_care_ritual_completion_invalid_step',
      'Self-care ritual completion contains a duplicate step.',
    )
  }

  if (submittedStepIds.every((stepId) => availableStepIds.has(stepId))) {
    return
  }

  throw new HttpError(
    409,
    'self_care_ritual_step_conflict',
    'Self-care ritual steps changed before this completion was saved.',
    { entityId: itemId, entityType: 'item' },
  )
}

function assertChildRecordIdsAvailable<
  TRecord extends { id: string; itemId: string },
>(
  stored: Map<string, TRecord>,
  candidates: readonly TRecord[],
  itemId: string,
  allowSameItem = false,
): void {
  const candidateIds = new Set<string>()

  for (const candidate of candidates) {
    const existing = stored.get(candidate.id)

    if (
      candidateIds.has(candidate.id) ||
      (existing && (!allowSameItem || existing.itemId !== itemId))
    ) {
      throw new HttpError(
        409,
        'self_care_item_id_conflict',
        'A self-care item identifier is already in use.',
      )
    }

    candidateIds.add(candidate.id)
  }
}

function restoreMap<TKey, TValue>(
  target: Map<TKey, TValue>,
  snapshot: Map<TKey, TValue>,
): void {
  target.clear()
  for (const [key, value] of snapshot) {
    target.set(key, value)
  }
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

function assertExerciseCompletionInput(
  item: StoredSelfCareItemRecord,
  input: CompleteSelfCareItemNowCommand['input'],
): void {
  if (item.type !== 'exercise') {
    return
  }

  if (input.measurementValue === null || input.measurementValue === undefined) {
    throw new HttpError(
      400,
      'self_care_exercise_value_required',
      'Exercise value is required.',
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
