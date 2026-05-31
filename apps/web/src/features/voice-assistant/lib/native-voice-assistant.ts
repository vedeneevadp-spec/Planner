import { App } from '@capacitor/app'
import {
  Capacitor,
  type PluginListenerHandle,
  registerPlugin,
} from '@capacitor/core'
import type {
  PlannerIntent,
  PlannerIntentName,
  VoiceActionResult,
  VoiceAssistantSource,
  VoiceMetricWakeWordProvider,
} from '@planner/contracts'

import {
  type AndroidVoicePushToTalkFallbackStatus,
  type AndroidVoiceRuntimeError,
  type AndroidVoiceRuntimeMetric,
  type AndroidVoiceRuntimeStatus,
  DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS,
  readVoiceAssistantDeviceSettings,
  updateVoiceAssistantDeviceSettings,
  VOICE_ASSISTANT_CONFIRMATION_MODE,
  VOICE_ASSISTANT_RECOGNITION_LANGUAGE,
  VOICE_ASSISTANT_WAKE_PHRASE,
  type VoiceAssistantForegroundServiceStatus,
  type VoiceAssistantPermissionStatus,
  type VoiceAssistantWakeWordModelStatus,
} from '../model/voice-assistant-settings'

export interface NativeVoiceAssistantApiConfig {
  accessToken?: string | undefined
  actorUserId: string
  apiBaseUrl: string
  wakeWordTrainingModeEnabled?: boolean | undefined
  workspaceId: string
}

export interface NativeVoiceCommand {
  capturedAt: string
  errorCode?: string | null
  errorMessage?: string | null
  id: string
  intent?: PlannerIntent | null
  source?:
    | 'ANDROID_PUSH_TO_TALK'
    | 'ANDROID_SHORT_CLIP'
    | 'LOCAL_FALLBACK'
    | 'TEST_STUB'
    | null
  transcript?: string | null
}

export interface NativeVoiceActionResultNotification {
  changedData: boolean
  intent: PlannerIntentName
  requiresUnlock?: boolean | undefined
  source: VoiceAssistantSource
  status: VoiceActionResult['status']
}

export interface NativeWakeWordDiagnostics {
  currentScore: number
  detectionCount: number
  lastDetectionScore: number
  lastError: string
  lastMetric: string
  modelVersion: string
  phrase: string
  provider: VoiceMetricWakeWordProvider
  threshold: number
}

export interface NativeWakeWordFeedbackResult extends NativeWakeWordDiagnostics {
  collectionEnabled: boolean
  durationMs?: number
  hadPendingExample: boolean
  hasPendingExample: boolean
  sampleError?: string | null
  sampleLabel: 'false_accept' | 'false_reject' | 'skipped' | 'true_accept'
  sampleSaved: boolean
}

export interface NativeWakeWordTrainingCollectionStatus {
  falseAcceptCount: number
  falseRejectCount: number
  hasPendingExample: boolean
  isEnabled: boolean
  storagePath: string
  trueAcceptCount: number
}

export interface VoiceAssistantNativeStatus {
  batterySample?: {
    isCharging: boolean
    isPowerSaveMode: boolean
    levelPercent: number
  }
  backgroundWakeWordEnabled: boolean
  confirmationMode: typeof VOICE_ASSISTANT_CONFIRMATION_MODE
  cpuSample?: {
    processCpuPercent: number
  }
  foregroundServiceStatus: VoiceAssistantForegroundServiceStatus
  isAndroid: boolean
  memorySample?: {
    maxMb: number
    usedMb: number
  }
  microphonePermission: VoiceAssistantPermissionStatus
  notificationPermission: VoiceAssistantPermissionStatus
  platform: 'android' | 'web'
  pushToTalkFallbackStatus: AndroidVoicePushToTalkFallbackStatus
  recognitionLanguage: typeof VOICE_ASSISTANT_RECOGNITION_LANGUAGE
  runtimeDurationMs: number
  runtimeLastError: AndroidVoiceRuntimeError | null
  runtimeMetrics: Partial<Record<AndroidVoiceRuntimeMetric, number>>
  runtimeStatus: AndroidVoiceRuntimeStatus
  voiceCuesEnabled: boolean
  wakePhrase: typeof VOICE_ASSISTANT_WAKE_PHRASE
  wakeWordEnabled: boolean
  wakeWordModelVersion: string
  wakeWordModelStatus: VoiceAssistantWakeWordModelStatus
  wakeWordProvider: VoiceMetricWakeWordProvider
  wakeWordSensitivity: number
}

export interface NativePermissionResult {
  status: VoiceAssistantPermissionStatus
}

interface PlannerVoiceAssistantPlugin {
  captureCommand: (
    options: NativeVoiceAssistantApiConfig,
  ) => Promise<{ state: string; wakeWord: string }>
  consumePendingCommand: () => Promise<{
    command: NativeVoiceCommand | null
  }>
  getWakeWordDiagnostics: () => Promise<NativeWakeWordDiagnostics>
  getStatus: () => Promise<VoiceAssistantNativeStatus>
  getWakeWordTrainingCollectionStatus: () => Promise<NativeWakeWordTrainingCollectionStatus>
  notifyActionResult: (
    options: NativeVoiceActionResultNotification,
  ) => Promise<{ doneCuePlayed: boolean }>
  openWakeWordFalseRejectRecorder: () => Promise<NativeWakeWordTrainingCollectionStatus>
  openWakeWordDebug: () => Promise<NativeWakeWordDiagnostics>
  reportWakeWordFalseAccept: () => Promise<NativeWakeWordFeedbackResult>
  reportWakeWordFalseReject: () => Promise<NativeWakeWordDiagnostics>
  reportWakeWordTrueAccept: () => Promise<NativeWakeWordFeedbackResult>
  requestMicrophonePermission: () => Promise<NativePermissionResult>
  requestNotificationPermission: () => Promise<NativePermissionResult>
  openSystemAppSettings: () => Promise<void>
  openBatteryOptimizationSettings?: () => Promise<void>
  setBackgroundWakeWordEnabled: (options: { enabled: boolean }) => Promise<void>
  setVoiceCuesEnabled: (options: { enabled: boolean }) => Promise<void>
  setWakeWordEnabled: (options: { enabled: boolean }) => Promise<void>
  setWakeWordSensitivity: (options: { sensitivity: number }) => Promise<void>
  skipWakeWordFeedback: () => Promise<NativeWakeWordFeedbackResult>
  setWakeWordTrainingCollectionEnabled: (options: {
    enabled: boolean
  }) => Promise<NativeWakeWordTrainingCollectionStatus>
  start: (
    options: NativeVoiceAssistantApiConfig,
  ) => Promise<{ state: string; wakeWord: string }>
  stop: () => Promise<{ state: string }>
}

const NativePlannerVoiceAssistant = registerPlugin<PlannerVoiceAssistantPlugin>(
  'PlannerVoiceAssistant',
)

export const VOICE_ASSISTANT_SETTINGS_CHANGED_EVENT =
  'planner:voice-assistant-settings-changed'

export function isAndroidVoiceAssistantRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function startAndroidVoiceAssistant(
  options: NativeVoiceAssistantApiConfig,
): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return
  }

  await NativePlannerVoiceAssistant.start(options)
}

export async function getVoiceAssistantNativeStatus(): Promise<VoiceAssistantNativeStatus> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return createWebVoiceAssistantNativeStatus()
  }

  return NativePlannerVoiceAssistant.getStatus()
}

export async function setAndroidWakeWordEnabled(
  enabled: boolean,
): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    updateVoiceAssistantDeviceSettings({ androidWakeWordEnabled: enabled })
    notifyVoiceAssistantSettingsChanged()
    return
  }

  await NativePlannerVoiceAssistant.setWakeWordEnabled({ enabled })
  notifyVoiceAssistantSettingsChanged()
}

export async function setAndroidBackgroundWakeWordEnabled(
  enabled: boolean,
): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    updateVoiceAssistantDeviceSettings({ backgroundWakeWordEnabled: enabled })
    notifyVoiceAssistantSettingsChanged()
    return
  }

  await NativePlannerVoiceAssistant.setBackgroundWakeWordEnabled({ enabled })
  notifyVoiceAssistantSettingsChanged()
}

export async function setAndroidWakeWordSensitivity(
  sensitivity: number,
): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    updateVoiceAssistantDeviceSettings({ wakeWordSensitivity: sensitivity })
    notifyVoiceAssistantSettingsChanged()
    return
  }

  await NativePlannerVoiceAssistant.setWakeWordSensitivity({ sensitivity })
  notifyVoiceAssistantSettingsChanged()
}

export async function setAndroidVoiceCuesEnabled(
  enabled: boolean,
): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    updateVoiceAssistantDeviceSettings({ voiceCuesEnabled: enabled })
    notifyVoiceAssistantSettingsChanged()
    return
  }

  await NativePlannerVoiceAssistant.setVoiceCuesEnabled({ enabled })
  notifyVoiceAssistantSettingsChanged()
}

export async function requestAndroidMicrophonePermission(): Promise<NativePermissionResult> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return { status: 'unknown' }
  }

  const result = await NativePlannerVoiceAssistant.requestMicrophonePermission()
  notifyVoiceAssistantSettingsChanged()

  return result
}

export async function requestAndroidNotificationPermission(): Promise<NativePermissionResult> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return { status: 'unknown' }
  }

  const result =
    await NativePlannerVoiceAssistant.requestNotificationPermission()
  notifyVoiceAssistantSettingsChanged()

  return result
}

export async function openAndroidSystemAppSettings(): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return
  }

  await NativePlannerVoiceAssistant.openSystemAppSettings()
}

export async function openAndroidBatteryOptimizationSettings(): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return
  }

  await NativePlannerVoiceAssistant.openBatteryOptimizationSettings?.()
}

export async function captureAndroidVoiceCommand(
  options: NativeVoiceAssistantApiConfig,
): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return
  }

  await NativePlannerVoiceAssistant.captureCommand(options)
}

export async function stopAndroidVoiceAssistant(): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return
  }

  await NativePlannerVoiceAssistant.stop()
}

export async function consumePendingAndroidVoiceCommand(): Promise<NativeVoiceCommand | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  const { command } = await NativePlannerVoiceAssistant.consumePendingCommand()

  return command
}

export async function notifyAndroidVoiceActionResult(
  options: NativeVoiceActionResultNotification,
): Promise<boolean> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return false
  }

  const { doneCuePlayed } =
    await NativePlannerVoiceAssistant.notifyActionResult(options)

  return doneCuePlayed
}

export async function getAndroidWakeWordDiagnostics(): Promise<NativeWakeWordDiagnostics | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.getWakeWordDiagnostics()
}

export async function openAndroidWakeWordDebug(): Promise<NativeWakeWordDiagnostics | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.openWakeWordDebug()
}

export async function getAndroidWakeWordTrainingCollectionStatus(): Promise<NativeWakeWordTrainingCollectionStatus | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.getWakeWordTrainingCollectionStatus()
}

export async function setAndroidWakeWordTrainingCollectionEnabled(
  enabled: boolean,
): Promise<NativeWakeWordTrainingCollectionStatus | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.setWakeWordTrainingCollectionEnabled({
    enabled,
  })
}

export async function reportAndroidWakeWordTrueAccept(): Promise<NativeWakeWordFeedbackResult | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.reportWakeWordTrueAccept()
}

export async function reportAndroidWakeWordFalseAccept(): Promise<NativeWakeWordFeedbackResult | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.reportWakeWordFalseAccept()
}

export async function skipAndroidWakeWordFeedback(): Promise<NativeWakeWordFeedbackResult | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.skipWakeWordFeedback()
}

export async function openAndroidWakeWordFalseRejectRecorder(): Promise<NativeWakeWordTrainingCollectionStatus | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.openWakeWordFalseRejectRecorder()
}

export async function reportAndroidWakeWordFalseReject(): Promise<NativeWakeWordDiagnostics | null> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return null
  }

  return NativePlannerVoiceAssistant.reportWakeWordFalseReject()
}

export async function addAndroidVoiceAssistantResumeListener(
  listener: () => void,
): Promise<PluginListenerHandle> {
  return App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      listener()
    }
  })
}

export function addVoiceAssistantSettingsChangedListener(
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  window.addEventListener(VOICE_ASSISTANT_SETTINGS_CHANGED_EVENT, listener)

  return () => {
    window.removeEventListener(VOICE_ASSISTANT_SETTINGS_CHANGED_EVENT, listener)
  }
}

export function notifyVoiceAssistantSettingsChanged(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(VOICE_ASSISTANT_SETTINGS_CHANGED_EVENT))
}

function createWebVoiceAssistantNativeStatus(): VoiceAssistantNativeStatus {
  const settings =
    typeof window === 'undefined'
      ? DEFAULT_VOICE_ASSISTANT_DEVICE_SETTINGS
      : readVoiceAssistantDeviceSettings()

  return {
    backgroundWakeWordEnabled: settings.backgroundWakeWordEnabled,
    confirmationMode: VOICE_ASSISTANT_CONFIRMATION_MODE,
    foregroundServiceStatus: 'stopped',
    isAndroid: false,
    microphonePermission: 'unknown',
    notificationPermission: 'unknown',
    platform: 'web',
    pushToTalkFallbackStatus: 'available',
    recognitionLanguage: VOICE_ASSISTANT_RECOGNITION_LANGUAGE,
    runtimeDurationMs: 0,
    runtimeLastError: null,
    runtimeMetrics: {},
    runtimeStatus: 'disabled',
    voiceCuesEnabled: false,
    wakePhrase: VOICE_ASSISTANT_WAKE_PHRASE,
    wakeWordEnabled: false,
    wakeWordModelVersion: 'unknown',
    wakeWordModelStatus: 'missing',
    wakeWordProvider: 'mock',
    wakeWordSensitivity: settings.wakeWordSensitivity,
  }
}
