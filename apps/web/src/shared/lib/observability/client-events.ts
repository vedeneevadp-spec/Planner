export type ClientDiagnosticEventName =
  | 'auth_device_session_kept'
  | 'auth_request_failed'
  | 'auth_refresh_deferred'
  | 'auth_session_cleared'
  | 'offline_mutation_conflicted'
  | 'web_voice_local_validation_failed'
  | 'web_voice_permission_denied'
  | 'web_voice_recording_cancelled'
  | 'web_voice_recording_stopped'
  | 'web_voice_started'
  | 'web_voice_timeout'
  | 'web_voice_unsupported'
  | 'web_voice_upload_completed'
  | 'web_voice_upload_error'
  | 'web_voice_upload_started'
  | 'widget_completion_acknowledged'
  | 'widget_completion_queued'
  | 'widget_completion_replayed'

export type ClientDiagnosticEventLevel = 'error' | 'info' | 'warn'

export type ClientDiagnosticDetails = Record<
  string,
  boolean | number | string | null | undefined
>

export interface ClientDiagnosticEvent {
  details: Record<string, boolean | number | string | null>
  level: ClientDiagnosticEventLevel
  name: ClientDiagnosticEventName
  timestamp: string
}

interface ClientDiagnostics {
  clear: () => void
  events: ClientDiagnosticEvent[]
}

declare global {
  interface Window {
    __CHAOTIKA_DIAGNOSTICS__?: ClientDiagnostics
  }
}

const MAX_DIAGNOSTIC_EVENTS = 100
const MAX_DETAIL_STRING_LENGTH = 160

export function recordClientEvent(
  name: ClientDiagnosticEventName,
  details: ClientDiagnosticDetails = {},
  options: {
    level?: ClientDiagnosticEventLevel | undefined
  } = {},
): ClientDiagnosticEvent {
  const event: ClientDiagnosticEvent = {
    details: normalizeDetails(details),
    level: options.level ?? 'info',
    name,
    timestamp: new Date().toISOString(),
  }

  const diagnostics = getClientDiagnostics()

  diagnostics.events.push(event)

  if (diagnostics.events.length > MAX_DIAGNOSTIC_EVENTS) {
    diagnostics.events.splice(
      0,
      diagnostics.events.length - MAX_DIAGNOSTIC_EVENTS,
    )
  }

  writeConsoleEvent(event)

  return event
}

export function readClientEvents(): ClientDiagnosticEvent[] {
  return [...getClientDiagnostics().events]
}

function getClientDiagnostics(): ClientDiagnostics {
  if (typeof window === 'undefined') {
    return createClientDiagnostics()
  }

  window.__CHAOTIKA_DIAGNOSTICS__ ??= createClientDiagnostics()

  return window.__CHAOTIKA_DIAGNOSTICS__
}

function createClientDiagnostics(): ClientDiagnostics {
  return {
    clear() {
      this.events.splice(0, this.events.length)
    },
    events: [],
  }
}

function normalizeDetails(
  details: ClientDiagnosticDetails,
): ClientDiagnosticEvent['details'] {
  return Object.fromEntries(
    Object.entries(details)
      .filter((entry): entry is [string, boolean | number | string | null] => {
        const [, value] = entry

        return value !== undefined
      })
      .map(([key, value]) => [
        key,
        typeof value === 'string'
          ? value.slice(0, MAX_DETAIL_STRING_LENGTH)
          : value,
      ]),
  )
}

function writeConsoleEvent(event: ClientDiagnosticEvent): void {
  if (import.meta.env.MODE === 'test') {
    return
  }

  switch (event.level) {
    case 'error':
      console.error('[chaotika:event]', event)
      return

    case 'warn':
      console.warn('[chaotika:event]', event)
      return

    case 'info':
      console.info('[chaotika:event]', event)
      return
  }
}
