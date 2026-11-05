import { describe, expect, it } from 'vitest'

import type { CalendarEventDraft } from '../lib/native-calendar-events'
import { toTaskComposerDraft } from './calendar-event-draft'

const event: CalendarEventDraft = {
  requestId: 'event-1',
  title: 'Встреча',
  description: 'Обсудить проект',
  location: 'Переговорная',
  beginTime: Date.parse('2026-11-05T11:40:00Z'),
  endTime: Date.parse('2026-11-05T12:30:00Z'),
  allDay: false,
}

describe('calendar event draft', () => {
  it('converts the event instant to the planner timezone and keeps the received date', () => {
    expect(toTaskComposerDraft(event, 'Asia/Novosibirsk')).toMatchObject({
      title: 'Встреча',
      note: 'Обсудить проект\n\nМесто: Переговорная',
      plannedDate: '2026-11-05',
      plannedStartTime: '18:40',
      plannedEndTime: '19:30',
      preservePlannedDate: true,
    })
    expect(toTaskComposerDraft(event, 'Europe/Samara').plannedStartTime).toBe(
      '15:40',
    )
  })

  it('keeps an all-day calendar date independent of the device timezone', () => {
    expect(
      toTaskComposerDraft(
        {
          ...event,
          allDay: true,
          beginTime: Date.parse('2026-11-05T00:00:00Z'),
        },
        'America/Los_Angeles',
      ),
    ).toMatchObject({
      plannedDate: '2026-11-05',
      plannedStartTime: null,
      plannedEndTime: null,
    })
  })

  it('leaves missing or malformed dates flexible and does not invent a title', () => {
    for (const beginTime of [null, NaN, -1, Number.MAX_SAFE_INTEGER]) {
      expect(
        toTaskComposerDraft({ ...event, title: '', beginTime }, 'UTC'),
      ).toMatchObject({
        title: '',
        plannedDate: null,
        plannedStartTime: null,
        plannedEndTime: null,
      })
    }
  })

  it('preserves a cross-midnight end in the note instead of creating an invalid time range', () => {
    const draft = toTaskComposerDraft(
      { ...event, endTime: Date.parse('2026-11-06T03:00:00Z') },
      'Asia/Novosibirsk',
    )
    expect(draft.plannedEndTime).toBeNull()
    expect(draft.note).toContain('Окончание:')
    expect(draft.note).toContain('10:00')
  })

  it('ignores reversed end times and avoids duplicating a location from the description', () => {
    expect(
      toTaskComposerDraft(
        {
          ...event,
          description: 'Место: Переговорная',
          endTime: event.beginTime! - 1,
        },
        'UTC',
      ),
    ).toMatchObject({
      plannedEndTime: null,
      note: 'Место: Переговорная',
    })
  })
})
