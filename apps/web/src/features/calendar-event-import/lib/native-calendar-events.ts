import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export interface CalendarEventDraft {
  requestId: string
  title: string
  description: string
  location: string
  beginTime: number | null
  endTime: number | null
  allDay: boolean
}

interface CalendarEventsPlugin {
  readPendingEvent(): Promise<{ event: CalendarEventDraft | null }>
  acknowledgeEvent(input: { requestId: string }): Promise<void>
  addListener(
    event: 'pendingEvent',
    listener: () => void,
  ): Promise<PluginListenerHandle>
}

export const nativeCalendarEvents = registerPlugin<CalendarEventsPlugin>(
  'PlannerCalendarEvents',
)
