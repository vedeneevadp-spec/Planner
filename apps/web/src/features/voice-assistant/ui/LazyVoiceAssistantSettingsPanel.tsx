import { lazy, Suspense } from 'react'

const VoiceAssistantSettingsPanelComponent = lazy(() =>
  import('./VoiceAssistantSettingsPanel').then((module) => ({
    default: module.VoiceAssistantSettingsPanel,
  })),
)

export function LazyVoiceAssistantSettingsPanel() {
  return (
    <Suspense fallback={null}>
      <VoiceAssistantSettingsPanelComponent />
    </Suspense>
  )
}
