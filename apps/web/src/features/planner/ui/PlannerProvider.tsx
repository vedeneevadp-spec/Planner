import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import {
  lazy,
  type PropsWithChildren,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react'

import { useSessionAuth } from '@/features/session'
import { AsyncLoadErrorBoundary } from '@/shared/ui/AsyncLoadErrorBoundary'

import { PlannerContext } from '../model/planner-context'
import { usePlannerState } from '../model/usePlannerState'
import styles from './PlannerProvider.module.css'

function loadTaskActionSnackbar() {
  return import('./PlannerTaskActionSnackbar').then((module) => ({
    default: module.PlannerTaskActionSnackbar,
  }))
}
const PlannerTaskActionSnackbar = lazy(loadTaskActionSnackbar)

export function PlannerQueryProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: {
            retry: 0,
          },
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <PlannerQuerySessionBoundary />
      {children}
    </QueryClientProvider>
  )
}

function PlannerQuerySessionBoundary() {
  const queryClient = useQueryClient()
  const { lifecycleStatus, userId } = useSessionAuth()
  const previousUserIdRef = useRef(userId)

  useEffect(() => {
    const previousUserId = previousUserIdRef.current
    previousUserIdRef.current = userId

    if (
      lifecycleStatus === 'signed_out' ||
      (previousUserId !== null && previousUserId !== userId)
    ) {
      queryClient.clear()
    }
  }, [lifecycleStatus, queryClient, userId])

  return null
}

export function PlannerProvider({ children }: PropsWithChildren) {
  const planner = usePlannerState()
  useEffect(() => {
    // Warm the optional UI after authentication so it is available if the
    // connection drops before the first task action. A failed chunk must never
    // unmount the planner or hide the confirmation of a saved offline command.
    const warm = () => {
      void loadTaskActionSnackbar().catch(() => undefined)
    }
    warm()
    window.addEventListener('online', warm)
    return () => window.removeEventListener('online', warm)
  }, [])
  const snackbarFallback = planner.taskActionSnackbar ? (
    <div className={styles.snackbar} role="status">
      <span>{planner.taskActionSnackbar.message}</span>
      <button
        className={styles.snackbarCloseButton}
        type="button"
        aria-label="Закрыть уведомление"
        onClick={planner.clearTaskActionSnackbar}
      >
        ×
      </button>
    </div>
  ) : null

  return (
    <PlannerContext.Provider value={planner}>
      {children}
      {planner.taskActionSnackbar ? (
        <AsyncLoadErrorBoundary fallback={snackbarFallback}>
          <Suspense fallback={snackbarFallback}>
            <PlannerTaskActionSnackbar planner={planner} />
          </Suspense>
        </AsyncLoadErrorBoundary>
      ) : null}
    </PlannerContext.Provider>
  )
}
