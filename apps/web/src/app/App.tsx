import { PlannerProvider, PlannerQueryProvider } from '@/features/planner'
import { AuthGate, SessionProvider } from '@/features/session'
import { Sidebar } from '@/widgets/sidebar'

import styles from './App.module.css'
import { AppRouter } from './router'

function App() {
  return (
    <SessionProvider>
      <PlannerQueryProvider>
        <AuthGate>
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
