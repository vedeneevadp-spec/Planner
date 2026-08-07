import { lazy, Suspense } from 'react'

import { PageStateView } from '@/shared/ui/PageState'

const VoiceAssistantSettingsPanelComponent = lazy(() =>
  import('./VoiceAssistantSettingsPanel').then((module) => ({
    default: module.VoiceAssistantSettingsPanel,
  })),
)

export function LazyVoiceAssistantSettingsPanel() {
  return (
    <Suspense
      fallback={
        <PageStateView
          kind="loading"
          title="Загружаем настройки голосового помощника"
          skeletonVariant="settings"
        />
      }
    >
      <VoiceAssistantSettingsPanelComponent />
    </Suspense>
  )
}
