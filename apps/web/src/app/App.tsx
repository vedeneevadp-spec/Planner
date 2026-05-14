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
import { cx } from '@/shared/lib/classnames'
import { Sidebar } from '@/widgets/sidebar'

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
            <div
              className={cx(
                styles.shell,
                isSidebarCollapsed && styles.shellSidebarCollapsed,
              )}
            >
              <Sidebar
                isCollapsed={isSidebarCollapsed}
                onCollapsedChange={setIsSidebarCollapsed}
              />
              <main className={styles.main}>
                <AppRouter />
              </main>
            </div>
          </PlannerProvider>
        </AuthGate>
      </PlannerQueryProvider>
    </SessionProvider>
  )
}

export default App
