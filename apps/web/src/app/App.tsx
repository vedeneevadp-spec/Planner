import { PlannerProvider } from '@/features/planner'
import { Sidebar } from '@/widgets/sidebar'

import styles from './App.module.css'
import { AppRouter } from './router'

function App() {
  return (
    <PlannerProvider>
      <div className={styles.shell}>
        <Sidebar />
        <main className={styles.main}>
          <AppRouter />
        </main>
      </div>
    </PlannerProvider>
  )
}

export default App
