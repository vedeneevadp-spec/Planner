import { lazy, Suspense } from 'react'

const VoiceAssistantComponent = lazy(() =>
  import('./VoiceAssistant').then((module) => ({
    default: module.VoiceAssistant,
  })),
)

export function LazyVoiceAssistant() {
  return (
    <Suspense fallback={null}>
      <VoiceAssistantComponent />
    </Suspense>
  )
}
