import {
  findVoiceCorpusCoverageGaps,
  type PlannerIntent,
  PlannerIntentParser,
  type PlannerIntentParserContext,
  plannerIntentSchema,
  voiceCommandCorpusV1,
  type VoiceTestCase,
  voiceTestCaseSchema,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

describe('voice command test corpus', () => {
  it('is schema-valid, unique, and above the v1 coverage floor', () => {
    const ids = new Set<string>()

    for (const testCase of voiceCommandCorpusV1) {
      expect(voiceTestCaseSchema.safeParse(testCase).success, testCase.id).toBe(
        true,
      )
      expect(ids.has(testCase.id), testCase.id).toBe(false)
      ids.add(testCase.id)
    }

    expect(voiceCommandCorpusV1.length).toBeGreaterThanOrEqual(120)
    expect(findVoiceCorpusCoverageGaps(voiceCommandCorpusV1)).toEqual([])
  })

  it('keeps every expected intent valid against plannerIntentSchema', () => {
    for (const testCase of voiceCommandCorpusV1) {
      if (!testCase.expectedIntent) {
        continue
      }

      expect(
        plannerIntentSchema.safeParse(testCase.expectedIntent).success,
        testCase.id,
      ).toBe(true)
    }
  })

  it('captures the audio signal boundary cases before metrics and LLM fallback', () => {
    expect(getCorpusCase('audio_signal_001').expectedAudioSignal).toMatchObject(
      {
        start: 'play',
      },
    )
    expect(getCorpusCase('audio_signal_002').expectedAudioSignal).toMatchObject(
      {
        start: 'play',
      },
    )
    expect(getCorpusCase('audio_signal_003').expectedAudioSignal).toMatchObject(
      {
        start: 'not_play',
      },
    )

    for (const id of [
      'audio_signal_004',
      'audio_signal_005',
      'audio_signal_006',
    ]) {
      expect(getCorpusCase(id).expectedAudioSignal?.success, id).toBe('play')
    }

    for (const id of [
      'audio_signal_007',
      'audio_signal_008',
      'audio_signal_009',
      'audio_signal_010',
      'audio_signal_011',
      'audio_signal_012',
    ]) {
      expect(getCorpusCase(id).expectedAudioSignal?.success, id).toBe(
        'not_play',
      )
    }
  })

  it('marks private fields as redacted for metrics-sensitive cases', () => {
    const metricsSensitiveCases = voiceCommandCorpusV1.filter(
      (testCase) => testCase.expectedMetrics?.mustNotIncludePrivateFields,
    )

    expect(metricsSensitiveCases.length).toBeGreaterThanOrEqual(10)

    for (const testCase of metricsSensitiveCases) {
      expect(
        testCase.expectedPrivacy?.mustNotLog?.length ?? 0,
        testCase.id,
      ).toBeGreaterThan(0)
    }
  })

  it('keeps privacy expectations explicit for sensitive preview buckets', () => {
    const privacyCases = [
      {
        id: 'locked_screen_003',
        mustNotLog: ['audio', 'transcript', 'rawText', 'agendaItems'],
        mustNotShow: ['что у меня завтра'],
      },
      {
        id: 'locked_screen_004',
        mustNotLog: [
          'audio',
          'transcript',
          'rawText',
          'title',
          'targetQuery',
          'taskTitle',
          'candidates',
        ],
        mustNotShow: ['помыть окна'],
      },
      {
        id: 'dangerous_001',
        mustNotLog: [
          'transcript',
          'rawText',
          'title',
          'targetQuery',
          'taskTitle',
          'candidates',
        ],
        mustNotShow: ['Подтвердить'],
      },
      {
        id: 'reschedule_009',
        mustNotLog: [
          'transcript',
          'rawText',
          'title',
          'targetQuery',
          'taskTitle',
          'candidates',
        ],
        mustNotShow: ['rawText', 'targetQuery', 'candidates'],
      },
      {
        id: 'reschedule_010',
        mustNotLog: [
          'transcript',
          'rawText',
          'title',
          'targetQuery',
          'taskTitle',
          'candidates',
        ],
        mustNotShow: ['rawText', 'targetQuery', 'candidates'],
      },
      {
        id: 'privacy_security_002',
        mustNotLog: [
          'audio',
          'transcript',
          'rawText',
          'title',
          'targetQuery',
          'taskTitle',
          'candidates',
        ],
        mustNotShow: ['секретный договор'],
      },
    ] as const

    for (const privacyCase of privacyCases) {
      const testCase = getCorpusCase(privacyCase.id)

      expect(testCase.expectedPrivacy?.mustNotLog, privacyCase.id).toEqual(
        expect.arrayContaining([...privacyCase.mustNotLog]),
      )
      expect(testCase.expectedUI?.mustNotShow, privacyCase.id).toEqual(
        expect.arrayContaining([...privacyCase.mustNotShow]),
      )
    }
  })

  it('marks LLM fallback eligibility explicitly and only for safe low-risk cases', () => {
    const llmEligibleCases = voiceCommandCorpusV1.filter(
      (testCase) => testCase.llmFallbackAllowed,
    )

    expect(llmEligibleCases.length).toBeGreaterThanOrEqual(4)

    for (const testCase of voiceCommandCorpusV1) {
      expect(typeof testCase.llmFallbackAllowed, testCase.id).toBe('boolean')

      if (!testCase.llmFallbackAllowed) {
        continue
      }

      expect(testCase.context.isDeviceLocked, testCase.id).toBe(false)
      expect(testCase.expectedIntent?.intent, testCase.id).toMatch(
        /^(create_task|add_shopping_item)$/u,
      )
      expect(testCase.expectedIntent?.isDangerous, testCase.id).not.toBe(true)
      expect(testCase.expectedPreview?.status, testCase.id).toBe(
        'ready_for_confirmation',
      )
      expect(
        ['agenda', 'dangerous', 'locked_screen', 'reschedule'].includes(
          testCase.category,
        ),
        testCase.id,
      ).toBe(false)
    }

    for (const testCase of voiceCommandCorpusV1) {
      const intent = testCase.expectedIntent?.intent
      const mustDisableLlm =
        testCase.context.isDeviceLocked ||
        testCase.category === 'dangerous' ||
        testCase.category === 'locked_screen' ||
        testCase.category === 'reschedule' ||
        intent === 'get_agenda' ||
        intent === 'get_shopping_list' ||
        intent === 'reschedule_task' ||
        intent === 'unsupported' ||
        testCase.expectedIntent?.isDangerous === true ||
        testCase.expectedIntent?.requiresUnlock === true

      if (mustDisableLlm) {
        expect(testCase.llmFallbackAllowed, testCase.id).toBe(false)
      }
    }
  })

  it('matches parser expectations from the shared corpus', () => {
    const parser = new PlannerIntentParser()
    const parserCases = voiceCommandCorpusV1.filter(hasExpectedIntent)

    expect(parserCases.length).toBeGreaterThanOrEqual(120)

    for (const testCase of parserCases) {
      const actual = parser.parse(testCase.phrase, toParserContext(testCase))

      expectPlannerIntentToMatchCorpus(actual, testCase)
    }
  })
})

function hasExpectedIntent(
  testCase: VoiceTestCase,
): testCase is VoiceTestCase & { expectedIntent: PlannerIntent } {
  return Boolean(testCase.expectedIntent)
}

function getCorpusCase(id: string): VoiceTestCase {
  const testCase = voiceCommandCorpusV1.find((candidate) => candidate.id === id)

  if (!testCase) {
    throw new Error(`Missing voice corpus case: ${id}`)
  }

  return testCase
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

function expectPlannerIntentToMatchCorpus(
  actual: PlannerIntent,
  testCase: VoiceTestCase & { expectedIntent: PlannerIntent },
): void {
  const expected = testCase.expectedIntent

  expect(actual.intent, testCase.id).toBe(expected.intent)
  expect(actual.rawText, testCase.id).toBe(testCase.phrase)
  expect(actual.needsConfirmation, testCase.id).toBe(expected.needsConfirmation)
  expectOptionalField(actual, expected, 'clarificationQuestion', testCase.id)
  expectOptionalField(actual, expected, 'date', testCase.id)
  expectOptionalField(actual, expected, 'datePrecision', testCase.id)
  expectOptionalField(actual, expected, 'isDangerous', testCase.id)
  expectOptionalField(actual, expected, 'reminderAt', testCase.id)
  expectOptionalField(actual, expected, 'requiresUnlock', testCase.id)
  expectOptionalField(actual, expected, 'sphereId', testCase.id)
  expectOptionalField(actual, expected, 'targetQuery', testCase.id)
  expectOptionalField(actual, expected, 'time', testCase.id)
  expectOptionalField(actual, expected, 'timeShiftMinutes', testCase.id)
  expectOptionalField(actual, expected, 'timeShiftText', testCase.id)
  expectOptionalField(actual, expected, 'title', testCase.id)

  if (expected.items) {
    expect(actual.items, testCase.id).toEqual(expected.items)
  }
}

function expectOptionalField<Key extends keyof PlannerIntent>(
  actual: PlannerIntent,
  expected: PlannerIntent,
  key: Key,
  id: string,
): void {
  if (expected[key] === undefined) {
    return
  }

  expect(actual[key], `${id}:${String(key)}`).toEqual(expected[key])
}
