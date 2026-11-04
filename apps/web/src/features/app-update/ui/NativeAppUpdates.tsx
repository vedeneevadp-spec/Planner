import { App as NativeApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

import {
  type AndroidAppUpdateState,
  nativeAppUpdates,
} from '../lib/native-app-updates'
import { setAppUpdateControls } from '../model/app-update-store'
import styles from './AppUpdatesProvider.module.css'

export function NativeAppUpdates() {
  const supported = isAndroidNativeRuntime()
  const [state, setState] = useState<AndroidAppUpdateState | null>(null)
  const [checking, setChecking] = useState(false)
  const [working, setWorking] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [manual, setManual] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  const seenBuild = useRef<number | null>(null)
  const wasDismissed = useRef(false)

  const acceptState = useCallback((next: AndroidAppUpdateState) => {
    if (!mounted.current) return
    const build = next.update?.versionCode ?? null
    if (build !== seenBuild.current) {
      setHidden(false)
      setNotice(null)
    } else if (wasDismissed.current && !next.dismissed) {
      setHidden(false)
    }
    seenBuild.current = build
    wasDismissed.current = next.dismissed
    setState(next)
  }, [])

  const check = useCallback(
    async (force: boolean) => {
      if (!supported || busy.current) return
      busy.current = true
      setChecking(true)
      if (force) {
        setHidden(false)
        setManual(true)
        setNotice(null)
      }
      try {
        const next = await nativeAppUpdates.check({ force })
        acceptState(next)
        if (force && mounted.current && !next.update) {
          setNotice('Установлена последняя версия Хаотики.')
        }
      } catch {
        if (force && mounted.current) {
          setNotice(
            'Не удалось проверить обновление. Попробуйте, когда появится связь.',
          )
        }
      } finally {
        busy.current = false
        if (mounted.current) setChecking(false)
      }
    },
    [acceptState, supported],
  )

  useEffect(() => {
    mounted.current = true
    if (!supported) return
    const handles: PluginListenerHandle[] = []
    let disposed = false
    const retain = (handle: PluginListenerHandle) => {
      if (disposed) void handle.remove()
      else handles.push(handle)
    }
    const refresh = async () => {
      try {
        acceptState(await nativeAppUpdates.getState())
      } catch {
        /* Automatic checks stay quiet. */
      }
      if (!disposed) await check(false)
    }
    void nativeAppUpdates
      .addListener('stateChange', acceptState)
      .then(retain)
      .catch(() => undefined)
    void NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh()
    })
      .then(retain)
      .catch(() => undefined)
    void refresh()
    return () => {
      disposed = true
      mounted.current = false
      setAppUpdateControls(null)
      for (const handle of handles) void handle.remove()
    }
  }, [acceptState, check, supported])

  const dismiss = () => {
    setHidden(true)
    setNotice(null)
    setManual(false)
    void nativeAppUpdates
      .dismiss()
      .then(acceptState)
      .catch(() => undefined)
  }

  const install = async () => {
    if (busy.current) return
    busy.current = true
    setWorking(true)
    setNotice(null)
    try {
      if (!state?.downloaded) acceptState(await nativeAppUpdates.download())
      await nativeAppUpdates.install()
      if (mounted.current)
        setNotice('Обновление скачано. Подтвердите установку в окне Android.')
    } catch (error) {
      if (mounted.current) {
        setNotice(
          error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'INSTALL_PERMISSION'
            ? 'Для обновления разрешите установку из Хаотики в настройках Android.'
            : 'Не удалось обновить приложение. Проверьте связь и свободное место, затем попробуйте ещё раз.',
        )
      }
      try {
        acceptState(await nativeAppUpdates.getState())
      } catch {
        /* Keep the retry action available. */
      }
    } finally {
      busy.current = false
      if (mounted.current) setWorking(false)
    }
  }

  const downloading = state?.downloading ?? false
  const installedVersion = state?.installedVersion ?? null
  useEffect(() => {
    setAppUpdateControls(
      supported
        ? {
            installedVersion,
            checking,
            busy: checking || working || downloading,
            check: () => {
              void check(true)
            },
          }
        : null,
    )
  }, [check, checking, downloading, installedVersion, supported, working])
  const visible =
    supported &&
    !hidden &&
    Boolean(notice || (state?.update && (manual || !state.dismissed)))

  return visible ? (
    <section className={styles.banner} aria-label="Обновление Хаотики">
      <div className={styles.copy}>
        <strong>
          {downloading
            ? `Скачиваем обновление · ${state?.progress ?? 0}%`
            : state?.update
              ? `Доступна Хаотика ${state.update.versionName}`
              : 'Обновление Хаотики'}
        </strong>
        {notice ? (
          <p role="status">{notice}</p>
        ) : state?.update?.notes ? (
          <p className={styles.notes}>{state.update.notes}</p>
        ) : null}
        {downloading ? (
          <progress
            aria-label="Скачивание обновления"
            max={100}
            value={state?.progress ?? 0}
          />
        ) : null}
      </div>
      <div className={styles.actions}>
        {state?.update ? (
          <button
            type="button"
            className={styles.primary}
            disabled={working || downloading || checking}
            onClick={() => {
              void install()
            }}
          >
            {downloading
              ? 'Скачиваем…'
              : state.downloaded
                ? 'Установить'
                : 'Обновить'}
          </button>
        ) : null}
        <button type="button" onClick={dismiss}>
          {downloading ? 'Скрыть' : state?.update ? 'Позже' : 'Закрыть'}
        </button>
      </div>
    </section>
  ) : null
}
