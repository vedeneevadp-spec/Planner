import { createContext } from 'react'

import type { PlannerState } from './planner.types'

export const PlannerContext = createContext<PlannerState | null>(null)
