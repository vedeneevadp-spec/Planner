import { useContext } from 'react'

import { SessionAuthContext } from '../model/session-auth-context'

export function useSessionAuth() {
  const auth = useContext(SessionAuthContext)

  if (!auth) {
    throw new Error('useSessionAuth must be used inside SessionProvider')
  }

  return auth
}
