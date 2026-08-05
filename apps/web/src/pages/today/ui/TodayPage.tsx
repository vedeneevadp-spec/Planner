import { usePlannerSession } from '@/features/session'

import { PersonalTodayPage } from './PersonalTodayPage'
import { SharedTodayPage } from './SharedTodayPage'

export function TodayPage() {
  const { data: session } = usePlannerSession()

  return session?.workspace.kind === 'shared' ? (
    <SharedTodayPage />
  ) : (
    <PersonalTodayPage />
  )
}
