import { PlannerProvider } from '@/features/planner'
import { AuthGate, SessionProvider } from '@/features/session'
import { Sidebar } from '@/widgets/sidebar'

import styles from './App.module.css'
import { AppRouter } from './router'

function App() {
  return (
    <SessionProvider>
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
    </SessionProvider>
  )
}

export default App
