import { App as NativeApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import { usePlanner } from '@/features/planner'
import { usePlannerTimeZone } from '@/features/session'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'

import { nativeCalendarEvents } from '../lib/native-calendar-events'
import { toTaskComposerDraft } from '../model/calendar-event-draft'

export function NativeCalendarEventImport() {
  const { isLoading } = usePlanner()
  const timeZone = usePlannerTimeZone()
  const [draft, setDraft] = useState<TaskComposerDraft | null>(null)
  const active = useRef<string | null>(null)
  const closed = useRef(new Set<string>())
  const refresh = useRef<() => void>(() => undefined)

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
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return
      reading = true
      pending = false
      try {
        const { event } = await nativeCalendarEvents.readPendingEvent()
        if (event && !disposed) {
          if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
            pending = true
            return
          }
          if (closed.current.has(event.requestId)) {
            await nativeCalendarEvents.acknowledgeEvent({
              requestId: event.requestId,
            })
            pending = true
          } else {
            active.current = event.requestId
            setDraft(toTaskComposerDraft(event, timeZone))
          }
        }
      } catch {
        // A transient native failure can be retried on the next foreground event.
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
    observer.observe(document.body, { childList: true, subtree: true })
    void nativeCalendarEvents
      .addListener('pendingEvent', schedule)
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

  const close = useCallback(() => {
    const requestId = active.current
    active.current = null
    setDraft(null)
    if (requestId) {
      closed.current.add(requestId)
      void nativeCalendarEvents
        .acknowledgeEvent({ requestId })
        .catch(() => undefined)
        .finally(() => refresh.current())
    }
  }, [])

  return draft ? (
    <TaskComposer
      key={draft.requestId}
      hideOpenButton
      initialPlannedDate={null}
      openDraft={draft}
      onClose={close}
    />
  ) : null
}
