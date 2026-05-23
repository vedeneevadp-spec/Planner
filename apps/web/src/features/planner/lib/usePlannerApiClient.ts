import { useMemo } from 'react'

import { useSessionFeatureReadiness } from '@/features/session'

import { createPlannerApiClient, type PlannerApiClient } from './planner-api'

export function usePlannerApiClient(): PlannerApiClient | null {
  const { apiConfig } = useSessionFeatureReadiness()

  return useMemo(
    () => (apiConfig ? createPlannerApiClient(apiConfig) : null),
    [apiConfig],
  )
}
