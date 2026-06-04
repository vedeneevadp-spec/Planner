import { canUseVoiceAssistant } from '@planner/contracts'
import { useRef } from 'react'

import { useSessionFeatureReadiness } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { MicIcon } from '@/shared/ui/Icon'

import { useAndroidVoiceRuntime } from '../model/useAndroidVoiceRuntime'
import { useVoiceActionFlow } from '../model/useVoiceActionFlow'
import {
  type AndroidWakeWordMetricStatus,
  useVoiceMetrics,
} from '../model/useVoiceMetrics'
import { useWebVoiceInput } from '../model/useWebVoiceInput'
import type { VoiceAppendSession } from '../model/voice-append-session'
import styles from './VoiceAssistant.module.css'
import {
  MAX_CLARIFICATION_ATTEMPTS,
  VoiceConfirmationCard,
} from './VoiceConfirmationCard'

export function VoiceAssistant() {
  const { apiConfig, session } = useSessionFeatureReadiness()
  const pendingAppendSessionRef = useRef<VoiceAppendSession | null>(null)
  const androidVoiceStatusRef = useRef<AndroidWakeWordMetricStatus | null>(null)
  const {
    createConfirmationTimingPayload,
    getVoiceTimingDuration,
    getVoiceTimingIntervalDuration,
    markVoiceTiming,
    resetVoiceTiming,
    trackVoiceMetric,
  } = useVoiceMetrics({
    androidVoiceStatusRef,
    apiConfig,
    appRole: session?.appRole,
  })
  const isVoiceEnabled =
    canUseVoiceAssistant(session?.appRole) &&
    (session?.userPreferences.voiceAssistantEnabled ?? true)
  const actionFlow = useVoiceActionFlow({
    createConfirmationTimingPayload,
    getVoiceTimingDuration,
    isVoiceEnabled,
    markVoiceTiming,
    maxClarificationAttempts: MAX_CLARIFICATION_ATTEMPTS,
    pendingAppendSessionRef,
    session,
    trackVoiceMetric,
  })
  const {
    actionPreview,
    actionResult,
    canAppendVoice,
    clarificationAttempts,
    closeActionFlow,
    dispatch,
    handleClarifyOption,
    handleConfirm,
    handleCreateFromNotFound,
    handleEditTranscript,
    handleSaveClarificationToInbox,
    handleTranscript,
    handleUndo,
    isCardVisible,
    isUndoing,
    plannerSpheres,
    prepareVoiceInputSession,
    selectedCandidateId,
    setActionPreview,
    setActionResult,
    setAppendSession,
    setIsCardVisible,
    setIsUndoing,
    setSelectedCandidateId,
    state,
  } = actionFlow

  const {
    cancelWebVoiceOperation,
    isWebListening: isRawWebListening,
    isWebProcessing,
    resetWebVoiceState,
    startWebVoiceInput,
    stopWebVoiceRecording,
    webVoiceMessage,
    webVoiceState,
  } = useWebVoiceInput({
    apiConfig,
    dispatch,
    getVoiceTimingIntervalDuration,
    handleTranscript,
    markVoiceTiming,
    pendingAppendSessionRef,
    resetVoiceTiming,
    setActionPreview,
    setActionResult,
    setIsCardVisible,
    setIsUndoing,
    setSelectedCandidateId,
    trackVoiceMetric,
  })
  const {
    cancelAndroidCommandPolling,
    isAndroidRuntime,
    startAndroidVoiceInput,
  } = useAndroidVoiceRuntime({
    androidVoiceStatusRef,
    apiConfig,
    dispatch,
    handleTranscript,
    isVoiceEnabled,
    markVoiceTiming,
    pendingAppendSessionRef,
    resetVoiceTiming,
    setActionPreview,
    setActionResult,
    setAppendSession,
    setIsCardVisible,
    setIsUndoing,
    setSelectedCandidateId,
    setWebVoiceIdle: resetWebVoiceState,
    trackVoiceMetric,
    wakeWordTrainingModeEnabled:
      session?.workspaceSettings.wakeWordTrainingModeEnabled,
  })
  const isWebListening = !isAndroidRuntime && isRawWebListening
  const isBusy =
    state.status === 'executing' ||
    isWebProcessing ||
    (isAndroidRuntime && state.status === 'recording')

  async function startVoiceInput(options: { appendRequested?: boolean } = {}) {
    if (!isVoiceEnabled) {
      return
    }

    if (isWebListening) {
      await stopWebVoiceRecording()
      return
    }

    prepareVoiceInputSession(options)

    if (isAndroidRuntime) {
      await startAndroidVoiceInput()
      return
    }

    await startWebVoiceInput()
  }

  function closeCard() {
    closeActionFlow()
    cancelAndroidCommandPolling()
    cancelWebVoiceOperation()
  }

  if (!isVoiceEnabled) {
    return null
  }

  return (
    <>
      <button
        className={cx(styles.micButton, isBusy && styles.micButtonBusy)}
        type="button"
        aria-label={getMicButtonLabel(isWebListening, isBusy)}
        title={getMicButtonLabel(isWebListening, isBusy)}
        disabled={isBusy && !isWebListening}
        onClick={() => {
          void startVoiceInput()
        }}
      >
        <MicIcon size={19} strokeWidth={2.1} />
      </button>

      {isCardVisible ? (
        <VoiceConfirmationCard
          clarificationAttempts={clarificationAttempts}
          isUndoing={isUndoing}
          canAppendVoice={canAppendVoice}
          preview={actionPreview}
          result={actionResult}
          selectedCandidateId={selectedCandidateId}
          spheres={plannerSpheres}
          state={state}
          webInputState={isAndroidRuntime ? undefined : webVoiceState}
          webStatusMessage={isAndroidRuntime ? null : webVoiceMessage}
          onCancelRecording={closeCard}
          onAppendVoice={() => {
            void startVoiceInput({ appendRequested: true })
          }}
          onClarifyOption={handleClarifyOption}
          onClose={closeCard}
          onConfirm={handleConfirm}
          onCreateFromNotFound={handleCreateFromNotFound}
          onEditTranscript={handleEditTranscript}
          onManualInput={closeCard}
          onRepeat={() => {
            void startVoiceInput()
          }}
          onStopRecording={
            isAndroidRuntime
              ? undefined
              : () => {
                  void stopWebVoiceRecording()
                }
          }
          onSaveClarificationToInbox={handleSaveClarificationToInbox}
          onSelectCandidate={setSelectedCandidateId}
          onUndo={() => {
            void handleUndo()
          }}
        />
      ) : null}
    </>
  )
}

function getMicButtonLabel(isWebListening: boolean, isBusy: boolean): string {
  if (isWebListening) {
    return 'Завершить запись'
  }

  return isBusy ? 'Идет распознавание' : 'Голосовой ввод'
}
