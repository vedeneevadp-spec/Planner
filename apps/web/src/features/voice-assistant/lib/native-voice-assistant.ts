import { App } from '@capacitor/app'
import {
  Capacitor,
  type PluginListenerHandle,
  registerPlugin,
} from '@capacitor/core'

export interface NativeVoiceCommand {
  capturedAt: string
  id: string
  transcript: string
}

export interface NativeWakeWordDiagnostics {
  currentScore: number
  detectionCount: number
  lastDetectionScore: number
  lastError: string
  lastMetric: string
  modelVersion: string
  phrase: string
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

interface PlannerVoiceAssistantPlugin {
  captureCommand: () => Promise<{ state: string; wakeWord: string }>
  consumePendingCommand: () => Promise<{
    command: NativeVoiceCommand | null
  }>
  getWakeWordDiagnostics: () => Promise<NativeWakeWordDiagnostics>
  getWakeWordTrainingCollectionStatus: () => Promise<NativeWakeWordTrainingCollectionStatus>
  openWakeWordFalseRejectRecorder: () => Promise<NativeWakeWordTrainingCollectionStatus>
  openWakeWordDebug: () => Promise<NativeWakeWordDiagnostics>
  reportWakeWordFalseAccept: () => Promise<NativeWakeWordFeedbackResult>
  reportWakeWordFalseReject: () => Promise<NativeWakeWordDiagnostics>
  reportWakeWordTrueAccept: () => Promise<NativeWakeWordFeedbackResult>
  skipWakeWordFeedback: () => Promise<NativeWakeWordFeedbackResult>
  setWakeWordTrainingCollectionEnabled: (options: {
    enabled: boolean
  }) => Promise<NativeWakeWordTrainingCollectionStatus>
  start: () => Promise<{ state: string; wakeWord: string }>
  stop: () => Promise<{ state: string }>
}

const NativePlannerVoiceAssistant = registerPlugin<PlannerVoiceAssistantPlugin>(
  'PlannerVoiceAssistant',
)

export function isAndroidVoiceAssistantRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function startAndroidVoiceAssistant(): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return
  }

  await NativePlannerVoiceAssistant.start()
}

export async function captureAndroidVoiceCommand(): Promise<void> {
  if (!isAndroidVoiceAssistantRuntime()) {
    return
  }

  await NativePlannerVoiceAssistant.captureCommand()
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
