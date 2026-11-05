import { App as NativeApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import {
  type IncomingShare,
  nativeIncomingShares,
} from '@/features/android-share/native-incoming-shares'
import {
  nativeCalendarEvents,
  toTaskComposerDraft,
} from '@/features/calendar-event-import'
import { usePlanner } from '@/features/planner'
import { usePlannerTimeZone } from '@/features/session'
import type { TaskComposerDraft } from '@/features/task-create'
import styles from '@/shared/ui/Snackbar/Snackbar.module.css'

const SharedDraft = lazy(() =>
  import('@/features/android-share/SharedDraft').then((module) => ({
    default: module.SharedDraft,
  })),
)
const TaskComposer = lazy(() =>
  import('@/features/task-create').then((module) => ({
    default: module.TaskComposer,
  })),
)

type IncomingDraft =
  | { kind: 'calendar'; data: TaskComposerDraft }
  | { kind: 'share'; data: IncomingShare }

async function readDraft(timeZone: string): Promise<IncomingDraft | null> {
  // Older APKs may expose just one plugin. A failed read must not block the other queue.
  const [calendar, share] = await Promise.allSettled([
    nativeCalendarEvents.readPendingEvent(),
    nativeIncomingShares.readPendingShare(),
  ])
  if (calendar.status === 'fulfilled' && calendar.value?.event) {
    return {
      kind: 'calendar',
      data: toTaskComposerDraft(calendar.value.event, timeZone),
    }
  }
  if (share.status === 'fulfilled' && share.value?.share) {
    return { kind: 'share', data: share.value.share }
  }
  return null
}

function acknowledge(draft: IncomingDraft) {
  const request = { requestId: draft.data.requestId }
  return draft.kind === 'calendar'
    ? nativeCalendarEvents.acknowledgeEvent(request)
    : nativeIncomingShares.acknowledgeShare(request)
}

const openDialog = 'dialog[open], [role="dialog"], [role="alertdialog"]'

export function NativeAndroidImports() {
  const { isLoading } = usePlanner()
  const timeZone = usePlannerTimeZone()
  const [draft, setDraft] = useState<IncomingDraft | null>(null)
  const [notice, setNotice] = useState('')
  const active = useRef<IncomingDraft | null>(null)
  const closed = useRef(new Set<string>())
  const refresh = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (isLoading) return
    let disposed = false
    let reading = false
    let pending = true
    const handles: PluginListenerHandle[] = []
    const retain = (handle: PluginListenerHandle) => {
      if (disposed) void handle.remove()
      else handles.push(handle)
    }
    const read = async () => {
      if (
        disposed ||
        reading ||
        !pending ||
        active.current ||
        document.querySelector(openDialog)
      )
        return
      reading = true
      pending = false
      try {
        const next = await readDraft(timeZone)
        if (next && !disposed) {
          if (document.querySelector(openDialog)) {
            pending = true
            return
          }
          if (closed.current.has(next.data.requestId)) {
            await acknowledge(next)
            closed.current.delete(next.data.requestId)
            pending = true
          } else {
            active.current = next
            setDraft(next)
          }
        }
      } catch {
        // Keep the encrypted queue intact and retry when the app resumes.
      } finally {
        reading = false
        if (pending) void read()
      }
    }
    const schedule = () => {
      pending = true
      void read()
    }
    refresh.current = schedule
    const observer = new MutationObserver(() => {
      void read()
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['open', 'role'],
      childList: true,
      subtree: true,
    })
    void nativeCalendarEvents
      .addListener('pendingEvent', schedule)
      .then(retain)
      .catch(() => undefined)
    void nativeIncomingShares
      .addListener('pendingShare', schedule)
      .then(retain)
      .catch(() => undefined)
    void NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) schedule()
    })
      .then(retain)
      .catch(() => undefined)
    void read()
    return () => {
      disposed = true
      observer.disconnect()
      refresh.current = () => undefined
      for (const handle of handles) void handle.remove()
    }
  }, [isLoading, timeZone])

  const close = useCallback((message?: string) => {
    const current = active.current
    if (!current) return
    setDraft(null)
    setNotice(message ?? '')
    closed.current.add(current.data.requestId)
    void acknowledge(current)
      .then(() => {
        closed.current.delete(current.data.requestId)
      })
      .catch(() => undefined)
      .finally(() => {
        active.current = null
        refresh.current()
      })
  }, [])

  return (
    <>
      <Suspense fallback={null}>
        {draft?.kind === 'calendar' && (
          <TaskComposer
            key={draft.data.requestId}
            hideOpenButton
            initialPlannedDate={null}
            openDraft={draft.data}
            onClose={() => close()}
          />
        )}
        {draft?.kind === 'share' && (
          <SharedDraft
            key={draft.data.requestId}
            share={draft.data}
            onClose={close}
          />
        )}
      </Suspense>
      {notice && (
        <div role="status" className={styles.snackbar}>
          <span className={styles.message}>{notice}</span>
        </div>
      )}
    </>
  )
}
