import type { VoiceTestCase, VoiceTestCaseCategory } from './schema.js'

export const VOICE_TEST_CASE_CATEGORIES = [
  'wake_word',
  'create_task',
  'reminder_task',
  'shopping',
  'agenda',
  'reschedule',
  'clarify',
  'unsupported',
  'dangerous',
  'locked_screen',
  'stt_error',
  'audio_signal',
  'web_flow',
  'android_runtime',
  'privacy_security',
] as const satisfies readonly VoiceTestCaseCategory[]

export const REQUIRED_VOICE_TEST_CORPUS_MINIMUMS = {
  agenda: 10,
  android_runtime: 8,
  clarify: 10,
  create_task: 20,
  dangerous: 10,
  locked_screen: 10,
  privacy_security: 10,
  reminder_task: 10,
  reschedule: 15,
  shopping: 15,
  stt_error: 10,
  unsupported: 10,
  audio_signal: 10,
  wake_word: 8,
  web_flow: 10,
} as const satisfies Record<VoiceTestCaseCategory, number>

export function countVoiceTestCasesByCategory(
  corpus: readonly VoiceTestCase[],
): Record<VoiceTestCaseCategory, number> {
  const counts = Object.fromEntries(
    VOICE_TEST_CASE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<VoiceTestCaseCategory, number>

  for (const testCase of corpus) {
    counts[testCase.category] += 1
  }

  return counts
}

export function findVoiceCorpusCoverageGaps(
  corpus: readonly VoiceTestCase[],
  minimums: Record<
    VoiceTestCaseCategory,
    number
  > = REQUIRED_VOICE_TEST_CORPUS_MINIMUMS,
): Array<{ actual: number; category: VoiceTestCaseCategory; minimum: number }> {
  const counts = countVoiceTestCasesByCategory(corpus)

  return VOICE_TEST_CASE_CATEGORIES.flatMap((category) => {
    const actual = counts[category]
    const minimum = minimums[category]

    return actual < minimum ? [{ actual, category, minimum }] : []
  })
}
