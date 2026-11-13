import { lazy, Suspense, useState } from 'react'

import { AppUpdatesProvider } from '@/features/app-update/provider'
import {
  NativePlannerWidgetSync,
  PlannerProvider,
  PlannerQueryProvider,
} from '@/features/planner'
import {
  AuthGate,
  NativePushRegistration,
  SessionProvider,
  TimeZoneChangeBanner,
} from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { AsyncLoadErrorBoundary } from '@/shared/ui/AsyncLoadErrorBoundary'
import { PlannerMobileHeader, PlannerTopTabs, Sidebar } from '@/widgets/sidebar'

import { AndroidImports } from './android-import/AndroidImports'
import styles from './App.module.css'
import { AppRouter } from './router'

const GooglePlayTestingBanner = lazy(() =>
  import('@/features/google-play-testing/ui/GooglePlayTestingBanner').then(
    (module) => ({ default: module.GooglePlayTestingBanner }),
  ),
)

function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  return (
    <AppUpdatesProvider>
      <SessionProvider>
        <PlannerQueryProvider>
          <AuthGate>
            <NativePushRegistration />
            <TimeZoneChangeBanner />
            <PlannerProvider>
              <NativePlannerWidgetSync />
              <AndroidImports />
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
                      <AsyncLoadErrorBoundary fallback={null}>
                        <Suspense fallback={null}>
                          <GooglePlayTestingBanner />
                        </Suspense>
                      </AsyncLoadErrorBoundary>
                      <AppRouter />
                    </div>
                  </main>
                </div>
              </div>
            </PlannerProvider>
          </AuthGate>
        </PlannerQueryProvider>
      </SessionProvider>
    </AppUpdatesProvider>
  )
}

export default App
