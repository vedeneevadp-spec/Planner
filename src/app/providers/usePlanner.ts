import { useContext } from 'react'

import { PlannerContext } from '@/app/providers/PlannerContext'

export function usePlanner() {
  const planner = useContext(PlannerContext)

  if (!planner) {
    throw new Error('usePlanner must be used inside PlannerProvider')
  }

  return planner
}
