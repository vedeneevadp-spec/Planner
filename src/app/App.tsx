import { PlannerProvider } from '@/app/providers/PlannerProvider'
import { AppRouter } from '@/app/router/AppRouter'
import { Sidebar } from '@/widgets/sidebar/ui/Sidebar'

import styles from './App.module.css'

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
