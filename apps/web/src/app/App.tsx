import { PlannerProvider, PlannerQueryProvider } from '@/features/planner'
import {
  AuthGate,
  NativePushRegistration,
  SessionProvider,
} from '@/features/session'
import { Sidebar } from '@/widgets/sidebar'

import styles from './App.module.css'
import { AppRouter } from './router'

function App() {
  return (
    <SessionProvider>
      <PlannerQueryProvider>
        <AuthGate>
          <NativePushRegistration />
          <PlannerProvider>
            <div className={styles.shell}>
              <Sidebar />
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
