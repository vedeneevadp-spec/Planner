import type { PropsWithChildren } from 'react'

import { useSessionAuthController } from '../lib/useSessionAuthController'
import { SessionAuthContext } from '../model/session-auth-context'

export function SessionProvider({ children }: PropsWithChildren) {
  const value = useSessionAuthController()

  return (
    <SessionAuthContext.Provider value={value}>
      {children}
    </SessionAuthContext.Provider>
  )
}
