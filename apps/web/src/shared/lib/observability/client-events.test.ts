import { beforeEach, describe, expect, it } from 'vitest'

import { readClientEvents, recordClientEvent } from './client-events'

describe('client diagnostic events', () => {
  beforeEach(() => {
    window.__CHAOTIKA_DIAGNOSTICS__?.clear()
  })

  it('stores sanitized client events in a global ring buffer', () => {
    recordClientEvent(
      'auth_device_session_kept',
      {
        hasStoredSession: true,
        longReason: 'x'.repeat(200),
        skipped: undefined,
      },
      { level: 'warn' },
    )

    const event = readClientEvents()[0]

    expect(event).toBeDefined()
    expect(event).toMatchObject({
      details: {
        hasStoredSession: true,
        longReason: 'x'.repeat(160),
      },
      level: 'warn',
      name: 'auth_device_session_kept',
    })
    expect(typeof event?.timestamp).toBe('string')
  })

  it('keeps only the latest diagnostic events', () => {
    for (let index = 0; index < 110; index += 1) {
      recordClientEvent('widget_completion_acknowledged', { index })
    }

    const events = readClientEvents()

    expect(events).toHaveLength(100)
    expect(events[0]?.details.index).toBe(10)
    expect(events.at(-1)?.details.index).toBe(109)
  })
})
