import type { PlannerIntent, VoiceActionPreview } from '@planner/contracts'

const SAFE_LOCKED_SCREEN_SUMMARY = 'Разблокируй телефон, чтобы продолжить.'

export interface SafeVoicePreviewTelemetryPayload {
  canExecute: boolean
  intentType: VoiceActionPreview['type']
  isDangerous: boolean
  isOffline?: boolean | undefined
  isStale?: boolean | undefined
  previewStatus: VoiceActionPreview['status']
  reason?: string | undefined
  requiresUnlock: boolean
}

export function sanitizeVoicePreviewForLockScreen(
  preview: VoiceActionPreview,
): VoiceActionPreview {
  return {
    ...preview,
    agendaItems: undefined,
    candidates: undefined,
    canExecute: false,
    intent: sanitizeLockedIntent(preview.intent),
    requiresUnlock: true,
    shoppingItems: undefined,
    status: 'requires_unlock',
    summary: SAFE_LOCKED_SCREEN_SUMMARY,
    title: 'Нужна разблокировка',
  }
}

export function createSafeVoicePreviewTelemetryPayload(
  preview: VoiceActionPreview,
): SafeVoicePreviewTelemetryPayload {
  return {
    canExecute: preview.canExecute,
    intentType: preview.type,
    isDangerous: preview.isDangerous,
    ...(preview.isOffline === undefined
      ? {}
      : { isOffline: preview.isOffline }),
    ...(preview.isStale === undefined ? {} : { isStale: preview.isStale }),
    previewStatus: preview.status,
    ...(preview.reason ? { reason: preview.reason } : {}),
    requiresUnlock: preview.requiresUnlock,
  }
}

function sanitizeLockedIntent(intent: PlannerIntent): PlannerIntent {
  const safeIntent: Partial<PlannerIntent> = {
    confidence: intent.confidence,
    date: intent.date,
    datePrecision: intent.datePrecision,
    dateText: intent.dateText,
    intent: intent.intent,
    isDangerous: intent.isDangerous,
    needsConfirmation: false,
    rawText: '',
    requiresUnlock: true,
    time: intent.time,
  }

  return safeIntent as PlannerIntent
}
