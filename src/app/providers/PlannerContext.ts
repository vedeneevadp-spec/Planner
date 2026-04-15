import { createContext } from 'react'

import type { PlannerState } from '@/features/planner/model/usePlannerState'

export const PlannerContext = createContext<PlannerState | null>(null)
