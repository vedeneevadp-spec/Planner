import { useCallback, useEffect, useState } from 'react'

import { getDeviceTimeZone } from '@/shared/time/time.service'

import { usePlannerSession } from '../lib/usePlannerSession'
import { useUpdateUserPreferences } from '../lib/useUserPreferences'
import styles from './TimeZoneChangeBanner.module.css'

interface TimeZoneChangeState {
  currentTimeZone: string
  previousTimeZone: string
}

export function TimeZoneChangeBanner() {
  const sessionQuery = usePlannerSession()
  const { mutate: updatePreferences } = useUpdateUserPreferences()
  const session = sessionQuery.data
  const [change, setChange] = useState<TimeZoneChangeState | null>(null)

  const detectTimeZoneChange = useCallback(() => {
    if (!session) {
      return
    }

    const currentTimeZone = getDeviceTimeZone()

    if (!currentTimeZone) {
      return
    }

    const previousTimeZone = session.userPreferences.lastSeenTimeZone

    if (!previousTimeZone) {
      updatePreferences({ lastSeenTimeZone: currentTimeZone })
      return
    }

    if (previousTimeZone !== currentTimeZone) {
      setChange({ currentTimeZone, previousTimeZone })
    }
  }, [session, updatePreferences])

  useEffect(() => {
    const timeoutId = window.setTimeout(detectTimeZoneChange, 0)

    return () => window.clearTimeout(timeoutId)
  }, [detectTimeZoneChange])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        detectTimeZoneChange()
      }
    }

    window.addEventListener('focus', detectTimeZoneChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', detectTimeZoneChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [detectTimeZoneChange])

  if (!change) {
    return null
  }

  const pendingChange = change

  function handleUseCurrentCity() {
    updatePreferences({
      lastSeenTimeZone: pendingChange.currentTimeZone,
      timeZoneMode: 'device',
    })
    setChange(null)
  }

  function handleKeepHomeTimeZone() {
    updatePreferences({
      defaultTimeZone: pendingChange.previousTimeZone,
      lastSeenTimeZone: pendingChange.currentTimeZone,
      timeZoneMode: 'manual',
    })
    setChange(null)
  }

  function handleConfigureManually() {
    updatePreferences({
      defaultTimeZone: pendingChange.previousTimeZone,
      lastSeenTimeZone: pendingChange.currentTimeZone,
      timeZoneMode: 'manual',
    })
    setChange(null)
  }

  return (
    <section
      aria-label="Часовой пояс изменился"
      className={styles.banner}
      role="status"
    >
      <div className={styles.content}>
        <strong>Часовой пояс изменился</strong>
        <span>
          {pendingChange.previousTimeZone} -&gt; {pendingChange.currentTimeZone}
        </span>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={handleUseCurrentCity}>
          Использовать текущий город
        </button>
        <button type="button" onClick={handleKeepHomeTimeZone}>
          Оставить домашний часовой пояс
        </button>
        <button type="button" onClick={handleConfigureManually}>
          Настроить вручную
        </button>
      </div>
    </section>
  )
}
