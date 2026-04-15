import type { PropsWithChildren } from 'react'

import { PlannerContext } from '../model/planner-context'
import { usePlannerState } from '../model/usePlannerState'

export function PlannerProvider({ children }: PropsWithChildren) {
  const planner = usePlannerState()

  return (
    <PlannerContext.Provider value={planner}>
      {children}
    </PlannerContext.Provider>
  )
}
