import type { PropsWithChildren } from 'react'

import { PlannerContext } from '@/app/providers/PlannerContext'
import { usePlannerState } from '@/features/planner/model/usePlannerState'

export function PlannerProvider({ children }: PropsWithChildren) {
  const planner = usePlannerState()

  return (
    <PlannerContext.Provider value={planner}>
      {children}
    </PlannerContext.Provider>
  )
}
