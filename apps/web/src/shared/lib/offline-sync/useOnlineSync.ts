import { useEffect } from 'react'

interface UseOnlineSyncOptions {
  enabled?: boolean | undefined
  onOnline: () => unknown
}

export function useOnlineSync({
  enabled = true,
  onOnline,
}: UseOnlineSyncOptions): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }

    function handleOnline() {
      void onOnline()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [enabled, onOnline])
}
