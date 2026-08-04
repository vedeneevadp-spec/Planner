import { canUseVoiceAssistant } from '@planner/contracts'
import { lazy, Suspense, useEffect, useState } from 'react'

import { useSessionFeatureReadiness } from '@/features/session'
import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

const WEB_VOICE_ASSISTANT_MOUNT_DELAY_MS = 1_500

const VoiceAssistantComponent = lazy(() =>
  import('./VoiceAssistant').then((module) => ({
    default: module.VoiceAssistant,
  })),
)

export function LazyVoiceAssistant() {
  const { session } = useSessionFeatureReadiness()
  const isAndroidRuntime = isAndroidNativeRuntime()
  const isVoiceEnabled =
    canUseVoiceAssistant(session?.appRole) &&
    (session?.userPreferences.voiceAssistantEnabled ?? true)
  const [isDeferredMountReady, setIsDeferredMountReady] =
    useState(isAndroidRuntime)

  useEffect(() => {
    if (!isVoiceEnabled || isAndroidRuntime) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsDeferredMountReady(true)
    }, WEB_VOICE_ASSISTANT_MOUNT_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isAndroidRuntime, isVoiceEnabled])

  if (!isVoiceEnabled || !isDeferredMountReady) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <VoiceAssistantComponent />
    </Suspense>
  )
}
