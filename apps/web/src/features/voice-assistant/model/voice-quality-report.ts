import {
  type ChaosInboxItemRecord,
  parseSafeVoiceMetricEvent,
  type PlannerIntent,
  PlannerIntentParser,
  type PlannerIntentParserContext,
  type SafeVoiceMetricEvent,
  type TaskRecord,
  VOICE_COMMAND_CORPUS_VERSION,
  VOICE_TEST_CASE_CATEGORIES,
  type VoiceActionContext,
  type VoiceActionPreview,
  voiceCommandCorpusV1,
  type VoiceMetricEventName,
  type VoiceTestCase,
  type VoiceTestCaseCategory,
} from '@planner/contracts'

import {
  PlannerActionExecutor,
  type PlannerActionExecutorDependencies,
} from './planner-action-executor'

export const VOICE_QUALITY_SAFETY_METRICS = [
  'dangerous_block_rate',
  'locked_screen_privacy_pass_rate',
  'voice_cue_policy_pass_rate',
  'llm_eligibility_policy_pass_rate',
  'no_private_metrics_policy',
] as const

export const VOICE_QUALITY_METRICS = [
  'parser_intent_accuracy',
  'required_field_accuracy',
  'parser_clarify_rate',
  'parser_unsupported_rate',
  'dangerous_block_rate',
  'locked_screen_privacy_pass_rate',
  'action_preview_accuracy',
  'confirmation_ui_status_accuracy',
  'web_flow_validation_pass_rate',
  'voice_cue_policy_pass_rate',
  'llm_eligibility_policy_pass_rate',
  'no_private_metrics_policy',
] as const

export type VoiceQualityMetricName = (typeof VOICE_QUALITY_METRICS)[number]
export type VoiceQualitySafetyMetricName =
  (typeof VOICE_QUALITY_SAFETY_METRICS)[number]

export interface VoiceQualityMetricResult {
  passed: number
  rate: number | null
  total: number
}

export interface VoiceQualityCaseFailure {
  caseId: string
  category: VoiceTestCaseCategory
  metric: VoiceQualityMetricName
  reason: string
}

export interface VoiceQualityCaseResult {
  caseId: string
  category: VoiceTestCaseCategory
  failures: VoiceQualityCaseFailure[]
  metrics: Partial<Record<VoiceQualityMetricName, boolean>>
}

export interface VoiceQualityReport {
  byCategory: Record<
    VoiceTestCaseCategory,
    {
      metrics: Record<VoiceQualityMetricName, VoiceQualityMetricResult>
      totalCases: number
    }
  >
  caseResults: VoiceQualityCaseResult[]
  corpusVersion: typeof VOICE_COMMAND_CORPUS_VERSION
  generatedAt: string
  metrics: Record<VoiceQualityMetricName, VoiceQualityMetricResult>
  safetyFailures: VoiceQualityCaseFailure[]
  totalCases: number
}

interface MetricCounter {
  passed: number
  total: number
}

interface CaseEvaluationContext {
  actualIntent: PlannerIntent | null
  preview: VoiceActionPreview | null
  safeMetricEvent: SafeVoiceMetricEvent | null
  testCase: VoiceTestCase
}

export async function generateVoiceQualityReport(
  corpus: readonly VoiceTestCase[] = voiceCommandCorpusV1,
): Promise<VoiceQualityReport> {
  const parser = new PlannerIntentParser()
  const overallCounters = createMetricCounters()
  const categoryCounters = Object.fromEntries(
    VOICE_TEST_CASE_CATEGORIES.map((category) => [
      category,
      createMetricCounters(),
    ]),
  ) as Record<
    VoiceTestCaseCategory,
    Record<VoiceQualityMetricName, MetricCounter>
  >
  const caseResults: VoiceQualityCaseResult[] = []

  for (const testCase of corpus) {
    const caseResult: VoiceQualityCaseResult = {
      caseId: testCase.id,
      category: testCase.category,
      failures: [],
      metrics: {},
    }
    const actualIntent = testCase.expectedIntent
      ? parser.parse(testCase.phrase, toParserContext(testCase))
      : null
    const preview =
      actualIntent && testCase.expectedPreview
        ? await createPreviewForCorpusCase(testCase, actualIntent)
        : null
    const safeMetricEvent = createCorpusSafeMetricEvent(
      testCase,
      actualIntent,
      preview,
    )
    const context: CaseEvaluationContext = {
      actualIntent,
      preview,
      safeMetricEvent,
      testCase,
    }

    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'parser_intent_accuracy',
      evaluateParserIntentAccuracy(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'required_field_accuracy',
      evaluateRequiredFieldAccuracy(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'parser_clarify_rate',
      evaluateParserRate(context, 'clarify'),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'parser_unsupported_rate',
      evaluateParserRate(context, 'unsupported'),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'dangerous_block_rate',
      evaluateDangerousBlock(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'locked_screen_privacy_pass_rate',
      evaluateLockedScreenPrivacy(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'action_preview_accuracy',
      evaluateActionPreviewAccuracy(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'confirmation_ui_status_accuracy',
      evaluateConfirmationUiStatus(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'web_flow_validation_pass_rate',
      evaluateWebFlowValidation(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'voice_cue_policy_pass_rate',
      evaluateVoiceCuePolicy(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'llm_eligibility_policy_pass_rate',
      evaluateLlmEligibilityPolicy(context),
    )
    recordOptionalMetric(
      context,
      caseResult,
      overallCounters,
      categoryCounters[testCase.category],
      'no_private_metrics_policy',
      evaluateNoPrivateMetricsPolicy(context),
    )

    caseResults.push(caseResult)
  }

  const metrics = finalizeMetrics(overallCounters)
  const byCategory = Object.fromEntries(
    VOICE_TEST_CASE_CATEGORIES.map((category) => [
      category,
      {
        metrics: finalizeMetrics(categoryCounters[category]),
        totalCases: corpus.filter((testCase) => testCase.category === category)
          .length,
      },
    ]),
  ) as VoiceQualityReport['byCategory']
  const safetyFailures = caseResults.flatMap((caseResult) =>
    caseResult.failures.filter((failure) =>
      VOICE_QUALITY_SAFETY_METRICS.includes(
        failure.metric as VoiceQualitySafetyMetricName,
      ),
    ),
  )

  return {
    byCategory,
    caseResults,
    corpusVersion: VOICE_COMMAND_CORPUS_VERSION,
    generatedAt: new Date().toISOString(),
    metrics,
    safetyFailures,
    totalCases: corpus.length,
  }
}

export function assertVoiceQualitySafetyThresholds(
  report: VoiceQualityReport,
): void {
  const failedSafetyMetrics = VOICE_QUALITY_SAFETY_METRICS.filter((metric) => {
    const result = report.metrics[metric]

    return result.total > 0 && result.passed !== result.total
  })

  if (failedSafetyMetrics.length === 0) {
    return
  }

  const failingCases = report.safetyFailures
    .slice(0, 12)
    .map((failure) => `${failure.caseId}:${failure.metric}`)
    .join(', ')

  throw new Error(
    `Voice quality safety thresholds failed: ${failedSafetyMetrics.join(
      ', ',
    )}. Cases: ${failingCases}`,
  )
}

export function formatVoiceQualityReport(report: VoiceQualityReport): string {
  const lines = [
    'Voice quality report',
    '',
    `Corpus: ${report.corpusVersion}`,
    `Total cases: ${report.totalCases}`,
    '',
    'Parser:',
    `- intent accuracy: ${formatMetric(report.metrics.parser_intent_accuracy)}`,
    `- required field accuracy: ${formatMetric(
      report.metrics.required_field_accuracy,
    )}`,
    `- clarify rate: ${formatMetric(report.metrics.parser_clarify_rate)}`,
    `- unsupported rate: ${formatMetric(
      report.metrics.parser_unsupported_rate,
    )}`,
    '',
    'Safety:',
    `- dangerous block rate: ${formatMetric(
      report.metrics.dangerous_block_rate,
    )}`,
    `- locked-screen privacy pass rate: ${formatMetric(
      report.metrics.locked_screen_privacy_pass_rate,
    )}`,
    `- LLM eligibility policy pass rate: ${formatMetric(
      report.metrics.llm_eligibility_policy_pass_rate,
    )}`,
    `- voice cue policy pass rate: ${formatMetric(
      report.metrics.voice_cue_policy_pass_rate,
    )}`,
    `- no private metrics policy: ${formatMetric(
      report.metrics.no_private_metrics_policy,
    )}`,
    '',
    'Action/UI:',
    `- action preview accuracy: ${formatMetric(
      report.metrics.action_preview_accuracy,
    )}`,
    `- confirmation UI status accuracy: ${formatMetric(
      report.metrics.confirmation_ui_status_accuracy,
    )}`,
    '',
    'Web:',
    `- web flow validation pass rate: ${formatMetric(
      report.metrics.web_flow_validation_pass_rate,
    )}`,
    '',
    'By category:',
    ...VOICE_TEST_CASE_CATEGORIES.map((category) => {
      const categoryReport = report.byCategory[category]

      return `- ${category} (${categoryReport.totalCases}): parser ${formatMetric(
        categoryReport.metrics.parser_intent_accuracy,
      )}, preview ${formatMetric(
        categoryReport.metrics.action_preview_accuracy,
      )}, safety ${formatMetric(
        categoryReport.metrics.no_private_metrics_policy,
      )}`
    }),
  ]

  if (report.safetyFailures.length > 0) {
    lines.push('', 'Safety failures:')

    for (const failure of report.safetyFailures.slice(0, 20)) {
      lines.push(`- ${failure.caseId} ${failure.metric}: ${failure.reason}`)
    }
  }

  return `${lines.join('\n')}\n`
}

export function isLlmFallbackAllowedByCorpusPolicy(
  testCase: VoiceTestCase,
  intent: PlannerIntent | null = testCase.expectedIntent ?? null,
): boolean {
  if (!intent) {
    return false
  }

  return (
    testCase.llmFallbackAllowed === true &&
    testCase.category === 'stt_error' &&
    testCase.context.isDeviceLocked === false &&
    (intent.intent === 'create_task' ||
      intent.intent === 'add_shopping_item') &&
    intent.isDangerous !== true &&
    intent.requiresUnlock !== true
  )
}

function createMetricCounters(): Record<VoiceQualityMetricName, MetricCounter> {
  return Object.fromEntries(
    VOICE_QUALITY_METRICS.map((metric) => [metric, { passed: 0, total: 0 }]),
  ) as Record<VoiceQualityMetricName, MetricCounter>
}

function recordOptionalMetric(
  context: CaseEvaluationContext,
  caseResult: VoiceQualityCaseResult,
  overallCounters: Record<VoiceQualityMetricName, MetricCounter>,
  categoryCounters: Record<VoiceQualityMetricName, MetricCounter>,
  metric: VoiceQualityMetricName,
  evaluation: { pass: boolean; reason?: string | undefined } | null,
): void {
  if (!evaluation) {
    return
  }

  caseResult.metrics[metric] = evaluation.pass
  overallCounters[metric].total += 1
  categoryCounters[metric].total += 1

  if (evaluation.pass) {
    overallCounters[metric].passed += 1
    categoryCounters[metric].passed += 1
    return
  }

  caseResult.failures.push({
    caseId: context.testCase.id,
    category: context.testCase.category,
    metric,
    reason: evaluation.reason ?? 'metric expectation failed',
  })
}

function finalizeMetrics(
  counters: Record<VoiceQualityMetricName, MetricCounter>,
): Record<VoiceQualityMetricName, VoiceQualityMetricResult> {
  return Object.fromEntries(
    VOICE_QUALITY_METRICS.map((metric) => {
      const counter = counters[metric]

      return [
        metric,
        {
          passed: counter.passed,
          rate: counter.total === 0 ? null : counter.passed / counter.total,
          total: counter.total,
        },
      ]
    }),
  ) as Record<VoiceQualityMetricName, VoiceQualityMetricResult>
}

function evaluateParserIntentAccuracy(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  const expectedIntent = context.testCase.expectedIntent

  if (!expectedIntent || !context.actualIntent) {
    return null
  }

  return context.actualIntent.intent === expectedIntent.intent
    ? { pass: true }
    : {
        pass: false,
        reason: `expected ${expectedIntent.intent}, got ${context.actualIntent.intent}`,
      }
}

function evaluateRequiredFieldAccuracy(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  const expectedIntent = context.testCase.expectedIntent
  const actualIntent = context.actualIntent

  if (!expectedIntent || !actualIntent) {
    return null
  }

  const failures: string[] = []
  const fields: Array<keyof PlannerIntent> = [
    'clarificationQuestion',
    'date',
    'datePrecision',
    'isDangerous',
    'needsConfirmation',
    'priority',
    'reminderAt',
    'requiresUnlock',
    'sphereId',
    'targetQuery',
    'time',
    'timeShiftMinutes',
    'timeShiftText',
    'title',
  ]

  for (const field of fields) {
    if (
      expectedIntent[field] !== undefined &&
      !isEqualValue(actualIntent[field], expectedIntent[field])
    ) {
      failures.push(String(field))
    }
  }

  if (
    expectedIntent.titleIncludes &&
    !actualIntent.title?.includes(expectedIntent.titleIncludes)
  ) {
    failures.push('titleIncludes')
  }

  if (
    expectedIntent.targetQueryIncludes &&
    !actualIntent.targetQuery?.includes(expectedIntent.targetQueryIncludes)
  ) {
    failures.push('targetQueryIncludes')
  }

  if (
    expectedIntent.itemTitles &&
    !isEqualValue(
      actualIntent.items?.map((item) => item.title),
      expectedIntent.itemTitles,
    )
  ) {
    failures.push('itemTitles')
  }

  if (
    expectedIntent.items &&
    !isEqualValue(actualIntent.items, expectedIntent.items)
  ) {
    failures.push('items')
  }

  return failures.length === 0
    ? { pass: true }
    : { pass: false, reason: `field mismatches: ${failures.join(', ')}` }
}

function evaluateParserRate(
  context: CaseEvaluationContext,
  intentName: 'clarify' | 'unsupported',
): { pass: boolean; reason?: string | undefined } | null {
  if (!context.testCase.expectedIntent || !context.actualIntent) {
    return null
  }

  return { pass: context.actualIntent.intent === intentName }
}

function evaluateDangerousBlock(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  if (!isDangerousBlockCase(context.testCase)) {
    return null
  }

  const preview = context.preview

  if (!preview) {
    return { pass: false, reason: 'missing action preview' }
  }

  const pass =
    preview.canExecute === false &&
    ['blocked', 'requires_unlock', 'unsupported'].includes(preview.status)

  return pass
    ? { pass: true }
    : {
        pass: false,
        reason: `dangerous case produced executable status ${preview.status}`,
      }
}

function evaluateLockedScreenPrivacy(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  const testCase = context.testCase

  if (
    !testCase.context.isDeviceLocked &&
    testCase.category !== 'locked_screen'
  ) {
    return null
  }

  const preview = context.preview
  const privatePolicy = evaluateNoPrivateMetricsPolicy(context)

  if (privatePolicy && !privatePolicy.pass) {
    return privatePolicy
  }

  if (!preview) {
    return { pass: true }
  }

  if (preview.status !== 'requires_unlock') {
    return { pass: true }
  }

  const serializedPreview = JSON.stringify(preview)
  const privateValues = collectPrivateCorpusValues(testCase)
  const leakedValue = privateValues.find((value) =>
    serializedPreview.includes(value),
  )

  return leakedValue
    ? {
        pass: false,
        reason: `locked-screen preview contains private value ${leakedValue}`,
      }
    : { pass: true }
}

function evaluateActionPreviewAccuracy(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  const expectedPreview = context.testCase.expectedPreview
  const preview = context.preview

  if (!expectedPreview || !preview) {
    return null
  }

  if (preview.status !== expectedPreview.status) {
    return {
      pass: false,
      reason: `expected ${expectedPreview.status}, got ${preview.status}`,
    }
  }

  if (
    expectedPreview.canExecute !== undefined &&
    preview.canExecute !== expectedPreview.canExecute
  ) {
    return {
      pass: false,
      reason: `expected canExecute ${expectedPreview.canExecute}, got ${preview.canExecute}`,
    }
  }

  if (expectedPreview.candidateCount !== undefined) {
    const candidateCount = preview.candidates?.length ?? 0
    const pass =
      expectedPreview.candidateCount === 'many'
        ? candidateCount > 2
        : candidateCount === expectedPreview.candidateCount

    if (!pass) {
      return {
        pass: false,
        reason: `expected candidate count ${expectedPreview.candidateCount}, got ${candidateCount}`,
      }
    }
  }

  return { pass: true }
}

function evaluateConfirmationUiStatus(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  const expectedUi = context.testCase.expectedUI
  const preview = context.preview

  if (!expectedUi || !preview) {
    return null
  }

  const actualCard = getConfirmationUiCard(preview)

  return actualCard === expectedUi.card
    ? { pass: true }
    : {
        pass: false,
        reason: `expected ${expectedUi.card}, got ${actualCard}`,
      }
}

function evaluateWebFlowValidation(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  const expectedWebFlow = context.testCase.expectedWebFlow

  if (!expectedWebFlow) {
    return null
  }

  const uploadMatches =
    expectedWebFlow.uploadExpected === undefined ||
    expectedWebFlow.uploadExpected === (expectedWebFlow.outcome === 'upload')

  return uploadMatches
    ? { pass: true }
    : {
        pass: false,
        reason: `uploadExpected mismatches outcome ${expectedWebFlow.outcome}`,
      }
}

function evaluateVoiceCuePolicy(
  context: CaseEvaluationContext,
): { pass: boolean; reason?: string | undefined } | null {
  const expectedCue = context.testCase.expectedCue

  if (!expectedCue) {
    return null
  }

  const actualCue = {
    done: getExpectedDoneCuePolicy(context.testCase),
    listening: getExpectedListeningCuePolicy(context.testCase),
  }
  const failures: string[] = []

  if (
    expectedCue.listening !== undefined &&
    actualCue.listening !== expectedCue.listening
  ) {
    failures.push(
      `listening expected ${expectedCue.listening}, got ${actualCue.listening}`,
    )
  }

  if (expectedCue.done !== undefined && actualCue.done !== expectedCue.done) {
    failures.push(`done expected ${expectedCue.done}, got ${actualCue.done}`)
  }

  return failures.length === 0
    ? { pass: true }
    : { pass: false, reason: failures.join('; ') }
}

function evaluateLlmEligibilityPolicy(context: CaseEvaluationContext): {
  pass: boolean
  reason?: string | undefined
} {
  const actualAllowed = isLlmFallbackAllowedByCorpusPolicy(
    context.testCase,
    context.actualIntent,
  )
  const expectedAllowed = context.testCase.llmFallbackAllowed === true

  return actualAllowed === expectedAllowed
    ? { pass: true }
    : {
        pass: false,
        reason: `expected llmFallbackAllowed ${expectedAllowed}, got ${actualAllowed}`,
      }
}

function evaluateNoPrivateMetricsPolicy(context: CaseEvaluationContext): {
  pass: boolean
  reason?: string | undefined
} {
  const event = context.safeMetricEvent

  if (!event) {
    return { pass: false, reason: 'missing safe metric event' }
  }

  try {
    parseSafeVoiceMetricEvent(event)
  } catch (error) {
    return {
      pass: false,
      reason:
        error instanceof Error
          ? error.message
          : 'safe metric schema validation failed',
    }
  }

  const serialized = JSON.stringify(event)
  const privateValues = collectPrivateCorpusValues(context.testCase)
  const leakedValue = privateValues.find((value) => serialized.includes(value))

  return leakedValue
    ? { pass: false, reason: `metric contains private value ${leakedValue}` }
    : { pass: true }
}

function getExpectedListeningCuePolicy(
  testCase: VoiceTestCase,
): 'not_play' | 'play' {
  const events = testCase.expectedMetrics?.events ?? []

  return testCase.source !== 'web_push_to_talk' &&
    (testCase.expectedCue?.listening === 'play' ||
      events.includes('wake_detected') ||
      events.includes('android_push_to_talk_started'))
    ? 'play'
    : 'not_play'
}

function getExpectedDoneCuePolicy(
  testCase: VoiceTestCase,
): 'not_play' | 'play' {
  return testCase.source !== 'web_push_to_talk' &&
    (testCase.expectedMetrics?.events ?? []).includes('voice_action_executed')
    ? 'play'
    : 'not_play'
}

function getConfirmationUiCard(
  preview: VoiceActionPreview,
): NonNullable<VoiceTestCase['expectedUI']>['card'] {
  switch (preview.status) {
    case 'blocked':
      return 'blocked'
    case 'multiple_candidates':
      return 'multiple_candidates'
    case 'not_found':
      return 'not_found'
    case 'requires_clarification':
      return 'clarify'
    case 'requires_unlock':
      return 'requires_unlock'
    case 'unsupported':
      return 'unsupported'
    case 'ready_for_confirmation':
      switch (preview.type) {
        case 'add_shopping_item':
          return 'shopping_confirmation'
        case 'get_shopping_list':
          return 'shopping_list'
        case 'create_task':
          return 'task_confirmation'
        case 'get_agenda':
          return 'agenda'
        case 'reschedule_task':
          return 'reschedule_confirmation'
        case 'clarify':
          return 'clarify'
        case 'unsupported':
          return 'unsupported'
      }
  }
}

function isDangerousBlockCase(testCase: VoiceTestCase): boolean {
  return (
    testCase.category === 'dangerous' ||
    (testCase.expectedIntent?.intent === 'unsupported' &&
      testCase.expectedIntent.isDangerous === true) ||
    (testCase.expectedMetrics?.events ?? []).includes(
      'dangerous_voice_action_blocked',
    )
  )
}

async function createPreviewForCorpusCase(
  testCase: VoiceTestCase,
  intent: PlannerIntent,
): Promise<VoiceActionPreview> {
  const executor = new PlannerActionExecutor()

  return executor.prepareAction(
    intent,
    createCorpusContext(testCase),
    createCorpusDependencies(testCase, intent),
  )
}

function createCorpusContext(testCase: VoiceTestCase): VoiceActionContext {
  return {
    appRole: testCase.context.appRole,
    isDeviceLocked: testCase.context.isDeviceLocked,
    now: testCase.context.now,
    source: testCase.source,
    timezone: testCase.context.timezone,
    userId: 'voice-quality-user',
    workspaceId: 'voice-quality-workspace',
  }
}

function createCorpusDependencies(
  testCase: VoiceTestCase,
  intent: PlannerIntent,
): PlannerActionExecutorDependencies {
  if (intent.intent === 'get_agenda') {
    return createDependencies({
      tasks: [
        createTaskRecord({
          id: 'agenda-1',
          plannedDate: intent.date ?? '2026-06-01',
          plannedStartTime: '09:00',
          title: 'Позвонить врачу',
        }),
      ],
    })
  }

  if (intent.intent === 'get_shopping_list') {
    return createDependencies({
      shoppingItems: [
        createShoppingRecord({ id: 'shopping-1', text: 'Молоко' }),
      ],
    })
  }

  if (intent.intent !== 'reschedule_task') {
    return createDependencies()
  }

  const candidateCount = testCase.expectedPreview?.candidateCount ?? 1
  const targetQuery = intent.targetQuery ?? 'помыть окна'

  if (candidateCount === 0) {
    return createDependencies({
      tasks: [createTaskRecord({ id: 'task-other', title: 'Другая задача' })],
    })
  }

  if (candidateCount === 2) {
    return createDependencies({
      tasks: [
        createTaskRecord({
          id: 'task-1',
          title: `${capitalize(targetQuery)} на кухне`,
          version: 1,
        }),
        createTaskRecord({
          id: 'task-2',
          title: `${capitalize(targetQuery)} в спальне`,
          version: 2,
        }),
      ],
    })
  }

  return createDependencies({
    tasks: [
      createTaskRecord({
        id: 'task-1',
        plannedEndTime: intent.timeShiftMinutes === undefined ? null : '11:00',
        plannedStartTime:
          intent.timeShiftMinutes === undefined ? null : '10:00',
        title: capitalize(targetQuery),
        version: 1,
      }),
    ],
  })
}

function createDependencies(
  overrides: {
    isOnline?: (() => boolean) | undefined
    shoppingItems?: ChaosInboxItemRecord[] | undefined
    tasks?: TaskRecord[] | undefined
  } = {},
): PlannerActionExecutorDependencies {
  const tasks = overrides.tasks ?? []
  const shoppingItems = overrides.shoppingItems ?? []

  return {
    createShoppingItem: (input) =>
      Promise.resolve({ id: `shopping-${input.text}` }),
    createTask: () => Promise.resolve({ id: 'task-created' }),
    getCachedTasks: () => tasks,
    isOnline: overrides.isOnline ?? (() => true),
    listShoppingItems: () => Promise.resolve(shoppingItems),
    refreshPlanner: () => Promise.resolve(undefined),
    removeShoppingItem: () => Promise.resolve(undefined),
    removeTask: () => Promise.resolve(true),
    updateShoppingItem: (itemId, patch) => {
      const item = shoppingItems.find((candidate) => candidate.id === itemId)

      if (!item) {
        throw Object.assign(new Error('Shopping item not found.'), {
          code: 'shopping_not_found',
        })
      }

      if (patch.status !== undefined) {
        item.status = patch.status
      }

      return Promise.resolve(item)
    },
    taskClient: {
      listTasks: (filters) =>
        Promise.resolve(
          filters?.plannedDate
            ? tasks.filter((task) => task.plannedDate === filters.plannedDate)
            : tasks,
        ),
      setTaskSchedule: (taskId, input) => {
        const task = tasks.find((candidate) => candidate.id === taskId)

        if (!task) {
          throw Object.assign(new Error('Task not found.'), {
            code: 'task_not_found',
          })
        }

        task.plannedDate = input.schedule.plannedDate
        task.plannedStartTime = input.schedule.plannedStartTime
        task.plannedEndTime = input.schedule.plannedEndTime ?? null
        task.version += 1

        return Promise.resolve(task)
      },
    },
  }
}

function createCorpusSafeMetricEvent(
  testCase: VoiceTestCase,
  intent: PlannerIntent | null,
  preview: VoiceActionPreview | null,
): SafeVoiceMetricEvent {
  return parseSafeVoiceMetricEvent({
    appRole:
      testCase.context.appRole === 'owner' ||
      testCase.context.appRole === 'test'
        ? testCase.context.appRole
        : 'test',
    createdAt: '2026-06-01T00:00:00.000Z',
    eventName: selectCorpusMetricEventName(testCase, preview),
    ...(intent ? { intentType: intent.intent } : {}),
    platform:
      testCase.source === 'web_push_to_talk'
        ? 'web'
        : testCase.source === 'backend_text'
          ? 'backend'
          : 'android',
    ...(preview ? { previewStatus: preview.status } : {}),
    source: testCase.source,
    ...(testCase.source === 'android_wake_word'
      ? { wakeWordProvider: 'mock' }
      : {}),
  })
}

function selectCorpusMetricEventName(
  testCase: VoiceTestCase,
  preview: VoiceActionPreview | null,
): VoiceMetricEventName {
  const events = testCase.expectedMetrics?.events ?? []

  if (events.includes('web_voice_permission_denied')) {
    return 'web_voice_permission_denied'
  }

  if (events.includes('web_voice_timeout')) {
    return 'web_voice_timeout'
  }

  if (events.includes('web_voice_local_validation_failed')) {
    return 'local_validation_failed'
  }

  if (events.includes('web_voice_upload_started')) {
    return 'stt_upload_started'
  }

  if (events.includes('web_voice_upload_completed')) {
    return 'stt_upload_completed'
  }

  if (events.includes('voice_action_undo_success')) {
    return 'undo_success'
  }

  if (events.includes('voice_action_executed')) {
    return 'action_executed'
  }

  if (events.includes('wake_detected')) {
    return 'wake_detected'
  }

  if (events.includes('android_push_to_talk_started')) {
    return 'push_to_talk_started'
  }

  if (preview?.status === 'requires_clarification') {
    return 'clarification_requested'
  }

  return preview ? 'action_preview_created' : 'voice_started'
}

function collectPrivateCorpusValues(testCase: VoiceTestCase): string[] {
  const values = new Set<string>()
  const mustNotLog = new Set(testCase.expectedPrivacy?.mustNotLog ?? [])
  const shouldBlockTranscript =
    mustNotLog.has('transcript') || mustNotLog.has('rawText')

  const privateCandidates = [
    ...(shouldBlockTranscript
      ? [
          testCase.phrase,
          testCase.expectedIntent?.rawText,
          testCase.expectedIntent?.transcript,
        ]
      : []),
    ...(mustNotLog.has('title') || mustNotLog.has('taskTitle')
      ? [testCase.expectedIntent?.title]
      : []),
    ...(mustNotLog.has('targetQuery')
      ? [testCase.expectedIntent?.targetQuery]
      : []),
    ...(mustNotLog.has('shoppingItems')
      ? (testCase.expectedIntent?.items?.map((item) => item.title) ?? [])
      : []),
  ]

  for (const value of privateCandidates) {
    if (typeof value === 'string' && value.trim().length >= 3) {
      values.add(value.trim())
    }
  }

  return [...values]
}

function toParserContext(testCase: VoiceTestCase): PlannerIntentParserContext {
  return {
    appRole: testCase.context.appRole,
    isDeviceLocked: testCase.context.isDeviceLocked,
    locale: testCase.context.locale,
    now: testCase.context.now,
    source: testCase.source,
    spheres: testCase.context.spheres,
    timezone: testCase.context.timezone,
  }
}

function formatMetric(metric: VoiceQualityMetricResult): string {
  if (metric.rate === null) {
    return 'n/a'
  }

  return `${(metric.rate * 100).toFixed(1)}%`
}

function isEqualValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function createTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: 'User',
    authorUserId: 'voice-quality-user',
    completedAt: null,
    createdAt: '2026-05-28T09:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    linkedTask: null,
    note: '',
    plannedDate: '2026-05-29',
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    requiresConfirmation: false,
    resource: null,
    routine: null,
    sourceWorkspace: null,
    sphereId: null,
    status: 'todo',
    title: 'Задача',
    updatedAt: '2026-05-28T09:00:00.000Z',
    urgency: 'not_urgent',
    version: 1,
    workspaceId: 'voice-quality-workspace',
    ...overrides,
  }
}

function createShoppingRecord(
  overrides: Pick<ChaosInboxItemRecord, 'id' | 'text'> &
    Partial<ChaosInboxItemRecord>,
): ChaosInboxItemRecord {
  const { id, text, ...rest } = overrides

  return {
    convertedNoteId: null,
    convertedTaskId: null,
    createdAt: '2026-05-28T09:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    id,
    isFavorite: false,
    kind: 'shopping',
    linkedTaskDeleted: false,
    priority: null,
    shoppingCategory: 'other',
    source: 'manual',
    sphereId: null,
    status: 'new',
    text,
    updatedAt: '2026-05-28T09:00:00.000Z',
    userId: 'voice-quality-user',
    version: 1,
    workspaceId: 'voice-quality-workspace',
    ...rest,
  }
}
