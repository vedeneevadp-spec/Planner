import { z } from 'zod'

import { appRoleSchema } from '../api.js'
import { plannerIntentSchema } from '../planner-intent.js'
import {
  voiceActionPreviewStatusSchema,
  voiceActionSourceSchema,
} from '../voice-action.js'

export const voiceTestCaseCategorySchema = z.enum([
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
])

export const voiceTestSphereSchema = z.object({
  id: z.string().trim().min(1),
  keywords: z.array(z.string().trim().min(1)).optional(),
  name: z.string().trim().min(1),
})

export const voiceTestContextSchema = z.object({
  appRole: appRoleSchema,
  featureGateRole: appRoleSchema.optional(),
  isDeviceLocked: z.boolean(),
  locale: z.literal('ru-RU'),
  now: z.string().trim().min(1),
  spheres: z.array(voiceTestSphereSchema).optional(),
  timezone: z.string().trim().min(1),
})

export const voiceTestExpectedIntentSchema = z.intersection(
  plannerIntentSchema,
  z.object({
    itemTitles: z.array(z.string().trim().min(1)).optional(),
    reminderAtOffsetMinutes: z.number().int().optional(),
    targetQueryIncludes: z.string().trim().min(1).optional(),
    titleIncludes: z.string().trim().min(1).optional(),
  }),
)

export const voiceTestExpectedPreviewSchema = z.object({
  canExecute: z.boolean().optional(),
  candidateCount: z
    .union([z.literal(0), z.literal(1), z.literal(2), z.literal('many')])
    .optional(),
  status: voiceActionPreviewStatusSchema,
})

export const voiceTestExpectedUiCardSchema = z.enum([
  'task_confirmation',
  'shopping_confirmation',
  'shopping_list',
  'reschedule_confirmation',
  'agenda',
  'clarify',
  'unsupported',
  'requires_unlock',
  'not_found',
  'multiple_candidates',
  'blocked',
])

export const voiceTestExpectedUiSchema = z.object({
  buttons: z.array(z.string().trim().min(1)).optional(),
  card: voiceTestExpectedUiCardSchema,
  mustNotShow: z.array(z.string().trim().min(1)).optional(),
  mustShow: z.array(z.string().trim().min(1)).optional(),
})

export const voiceTestExpectedAudioSignalSchema = z.object({
  start: z.enum(['play', 'not_play']).optional(),
  success: z.enum(['play', 'not_play']).optional(),
})

export const voicePrivateFieldSchema = z.enum([
  'audio',
  'transcript',
  'rawText',
  'title',
  'targetQuery',
  'taskTitle',
  'shoppingItems',
  'agendaItems',
  'candidates',
])

export const voiceTestExpectedPrivacySchema = z.object({
  mustNotLog: z.array(voicePrivateFieldSchema).optional(),
  uploadAllowed: z.boolean().optional(),
})

export const voiceTestExpectedMetricsSchema = z.object({
  events: z.array(z.string().trim().min(1)).optional(),
  mustNotIncludePrivateFields: z.boolean().optional(),
})

export const voiceTestExpectedWebFlowSchema = z.object({
  outcome: z.enum([
    'upload',
    'unsupported',
    'permission_denied',
    'needs_repeat',
    'timeout',
    'cancelled',
  ]),
  reason: z.string().trim().min(1).optional(),
  uploadExpected: z.boolean().optional(),
})

export const voiceTestExpectedAndroidRuntimeSchema = z.object({
  commandRecordingAllowed: z.boolean().optional(),
  runtimeStatus: z.string().trim().min(1).optional(),
  settingsPersisted: z.boolean().optional(),
  uploadAllowed: z.boolean().optional(),
  wakeDetected: z.boolean().optional(),
})

export const voiceTestCaseSchema = z.object({
  category: voiceTestCaseCategorySchema,
  context: voiceTestContextSchema,
  expectedAndroidRuntime: voiceTestExpectedAndroidRuntimeSchema.optional(),
  expectedAudioSignal: voiceTestExpectedAudioSignalSchema.optional(),
  expectedIntent: voiceTestExpectedIntentSchema.optional(),
  expectedMetrics: voiceTestExpectedMetricsSchema.optional(),
  expectedPreview: voiceTestExpectedPreviewSchema.optional(),
  expectedPrivacy: voiceTestExpectedPrivacySchema.optional(),
  expectedUI: voiceTestExpectedUiSchema.optional(),
  expectedWebFlow: voiceTestExpectedWebFlowSchema.optional(),
  id: z.string().trim().min(1),
  llmFallbackAllowed: z.boolean().optional(),
  notes: z.string().trim().min(1).optional(),
  phrase: z.string(),
  source: voiceActionSourceSchema,
})

export const voiceTestCorpusSchema = z.array(voiceTestCaseSchema)

export type VoiceTestCase = z.infer<typeof voiceTestCaseSchema>
export type VoiceTestCaseCategory = z.infer<typeof voiceTestCaseCategorySchema>
export type VoiceTestContext = z.infer<typeof voiceTestContextSchema>
export type VoiceTestExpectedAudioSignal = z.infer<
  typeof voiceTestExpectedAudioSignalSchema
>
export type VoiceTestExpectedIntent = z.infer<
  typeof voiceTestExpectedIntentSchema
>
export type VoiceTestExpectedPreview = z.infer<
  typeof voiceTestExpectedPreviewSchema
>
export type VoiceTestExpectedUi = z.infer<typeof voiceTestExpectedUiSchema>
export type VoiceTestExpectedUiCard = z.infer<
  typeof voiceTestExpectedUiCardSchema
>
