import { VoiceAssistantSettingsPanel } from '@/features/voice-assistant'
import { cx } from '@/shared/lib/classnames'
import pageStyles from '@/shared/ui/Page'

import styles from './VoiceAssistantSettingsPage.module.css'

export function VoiceAssistantSettingsPage() {
  return (
    <section className={cx(pageStyles.page, styles.page)}>
      <VoiceAssistantSettingsPanel />
    </section>
  )
}
