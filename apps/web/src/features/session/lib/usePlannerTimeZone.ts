import {
  getDeviceTimeZone,
  getPlannerTimeZone,
} from '@/shared/time/time.service'

import { usePlannerSession } from './usePlannerSession'

export function usePlannerTimeZone(): string {
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data

  return getPlannerTimeZone({
    deviceTimeZone: getDeviceTimeZone(),
    timeZoneMode: session?.userPreferences.timeZoneMode ?? null,
    userTimeZone: session?.userPreferences.defaultTimeZone ?? null,
    workspaceTimeZone: session?.workspaceSettings.defaultTimeZone ?? null,
  })
}
