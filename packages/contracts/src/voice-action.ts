import { z } from 'zod'

import { appRoleSchema } from './api.js'
import {
  plannerIntentNameSchema,
  plannerIntentSchema,
} from './planner-intent.js'
import { taskScheduleInputSchema } from './task.js'

export const voiceActionTypeSchema = plannerIntentNameSchema

export const voiceActionSourceSchema = z.enum([
  'android_wake_word',
  'android_push_to_talk',
  'web_push_to_talk',
  'backend_text',
])

export const voiceActionContextSchema = z.object({
  appRole: appRoleSchema,
  isDeviceLocked: z.boolean().optional(),
  now: z.string().trim().min(1),
  source: voiceActionSourceSchema,
  timezone: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
})

export const voiceActionPreviewStatusSchema = z.enum([
  'ready_for_confirmation',
  'requires_unlock',
  'requires_clarification',
  'not_found',
  'multiple_candidates',
  'unsupported',
  'blocked',
])

export const voiceActionCandidateSchema = z.object({
  isRecurring: z.boolean().optional(),
  plannedDate: z.string().nullable(),
  plannedEndTime: z.string().nullable().optional(),
  plannedStartTime: z.string().nullable(),
  taskId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  version: z.number().int().positive(),
})

export const voiceActionAgendaItemSchema = z.object({
  plannedEndTime: z.string().nullable().optional(),
  plannedStartTime: z.string().nullable(),
  status: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  title: z.string().trim().min(1),
})

export const voiceActionPreviewSchema = z.object({
  agendaItems: z.array(voiceActionAgendaItemSchema).optional(),
  candidates: z.array(voiceActionCandidateSchema).optional(),
  canExecute: z.boolean(),
  id: z.string().trim().min(1),
  intent: plannerIntentSchema,
  isDangerous: z.boolean(),
  isOffline: z.boolean().optional(),
  isStale: z.boolean().optional(),
  needsConfirmation: z.boolean(),
  reason: z.string().trim().min(1).optional(),
  requiresUnlock: z.boolean(),
  status: voiceActionPreviewStatusSchema,
  summary: z.string().trim().min(1),
  title: z.string().trim().min(1),
  type: voiceActionTypeSchema,
})

export const voiceActionConfirmedPayloadSchema = z.object({
  candidateTaskId: z.string().trim().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
})

export const voiceActionUndoSchema = z.discriminatedUnion('type', [
  z.object({
    createdTaskId: z.string().trim().min(1),
    type: z.literal('create_task'),
  }),
  z.object({
    createdShoppingItemIds: z.array(z.string().trim().min(1)).min(1),
    type: z.literal('add_shopping_item'),
  }),
  z.object({
    expectedVersion: z.number().int().positive(),
    previousSchedule: taskScheduleInputSchema,
    type: z.literal('reschedule_task'),
    updatedTaskId: z.string().trim().min(1),
  }),
])

export const voiceActionResultSchema = z.object({
  changedData: z.boolean().optional(),
  createdShoppingItemIds: z.array(z.string().trim().min(1)).optional(),
  createdTaskId: z.string().trim().min(1).optional(),
  errorCode: z.string().trim().min(1).optional(),
  status: z.enum(['success', 'failed', 'cancelled', 'requires_refresh']),
  undo: voiceActionUndoSchema.optional(),
  updatedTaskId: z.string().trim().min(1).optional(),
  visualStatus: z.string().trim().min(1),
})

export type VoiceActionType = z.infer<typeof voiceActionTypeSchema>
export type VoiceActionSource = z.infer<typeof voiceActionSourceSchema>
export type VoiceActionContext = z.infer<typeof voiceActionContextSchema>
export type VoiceActionPreviewStatus = z.infer<
  typeof voiceActionPreviewStatusSchema
>
export type VoiceActionCandidate = z.infer<typeof voiceActionCandidateSchema>
export type VoiceActionAgendaItem = z.infer<typeof voiceActionAgendaItemSchema>
export type VoiceActionPreview = z.infer<typeof voiceActionPreviewSchema>
export type VoiceActionConfirmedPayload = z.infer<
  typeof voiceActionConfirmedPayloadSchema
>
export type VoiceActionResult = z.infer<typeof voiceActionResultSchema>
export type VoiceActionUndo = z.infer<typeof voiceActionUndoSchema>
