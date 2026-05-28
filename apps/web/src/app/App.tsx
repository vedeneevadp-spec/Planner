import { useState } from 'react'

import {
  NativePlannerWidgetSync,
  PlannerProvider,
  PlannerQueryProvider,
} from '@/features/planner'
import {
  AuthGate,
  NativePushRegistration,
  SessionProvider,
} from '@/features/session'
import { VoiceAssistant } from '@/features/voice-assistant'
import { cx } from '@/shared/lib/classnames'
import { PlannerMobileHeader, PlannerTopTabs, Sidebar } from '@/widgets/sidebar'

import styles from './App.module.css'
import { AppRouter } from './router'

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  return (
    <SessionProvider>
      <PlannerQueryProvider>
        <AuthGate>
          <NativePushRegistration />
          <PlannerProvider>
            <NativePlannerWidgetSync />
            <VoiceAssistant />
            <div
              className={cx(
                styles.shell,
                isSidebarCollapsed && styles.shellSidebarCollapsed,
              )}
            >
              <Sidebar
                isCollapsed={isSidebarCollapsed}
                navigationMode="service"
                onCollapsedChange={setIsSidebarCollapsed}
              />
              <div className={styles.content}>
                <PlannerTopTabs />
                <main className={styles.main}>
                  <PlannerMobileHeader />
                  <div className={styles.routeSlot}>
                    <AppRouter />
                  </div>
                </main>
              </div>
            </div>
          </PlannerProvider>
        </AuthGate>
      </PlannerQueryProvider>
    </SessionProvider>
  )
}

export default App
