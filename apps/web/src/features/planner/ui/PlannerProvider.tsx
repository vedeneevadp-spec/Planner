import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type PropsWithChildren, useState } from 'react'

import { PlannerContext } from '../model/planner-context'
import { usePlannerState } from '../model/usePlannerState'

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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

export function PlannerProvider({ children }: PropsWithChildren) {
  const planner = usePlannerState()

  return (
    <PlannerContext.Provider value={planner}>
      {children}
    </PlannerContext.Provider>
  )
}
