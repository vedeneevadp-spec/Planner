import { useEffect } from 'react'

import { useOnlineSync } from './useOnlineSync'

interface UseOfflineQueueDrainOptions {
  drain: () => unknown
  drainOnMount?: boolean | undefined
  enabled?: boolean | undefined
}

export function useOfflineQueueDrain({
  drain,
  drainOnMount = true,
  enabled = true,
}: UseOfflineQueueDrainOptions): void {
  useEffect(() => {
    if (!enabled || !drainOnMount) {
      return
    }

    void drain()
  }, [drain, drainOnMount, enabled])

  useOnlineSync({
    enabled,
    onOnline: drain,
  })
}
