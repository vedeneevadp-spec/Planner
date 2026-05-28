import {
  initialVoiceAssistantState,
  PlannerIntentParser,
  reduceVoiceAssistantState,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

const NOW = new Date(2026, 4, 28, 9, 0, 0)

describe('PlannerIntentParser', () => {
  const parser = new PlannerIntentParser()

  it('parses task creation with wake word and datetime', () => {
    const intent = parser.parse(
      'Хаотика добавь задачу купить молоко завтра в 9 часов',
      { now: NOW },
    )

    expect(intent).toMatchObject({
      datetime: '2026-05-29T09:00',
      intent: 'create_task',
      needsConfirmation: true,
      title: 'купить молоко',
    })
  })

  it('parses simple reminders without confirmation', () => {
    const intent = parser.parse('Напомни оплатить интернет завтра в 10', {
      now: NOW,
    })

    expect(intent).toMatchObject({
      intent: 'create_reminder',
      needsConfirmation: false,
      reminderAt: '2026-05-29T10:00',
      title: 'оплатить интернет',
    })
  })

  it('parses shopping list additions', () => {
    const intent = parser.parse('Добавь в список покупок сыр', { now: NOW })

    expect(intent).toMatchObject({
      intent: 'add_shopping_item',
      list: 'shopping',
      needsConfirmation: true,
      title: 'сыр',
    })
  })

  it('keeps dangerous delete commands behind confirmation', () => {
    const intent = parser.parse('Удали все задачи завтра', { now: NOW })

    expect(intent.intent).toBe('delete')
    expect(intent.needsConfirmation).toBe(true)
  })

  it('parses event creation with explicit date', () => {
    const intent = parser.parse(
      'Создай событие встреча с врачом 30.05 в 14:30',
      {
        now: NOW,
      },
    )

    expect(intent).toMatchObject({
      datetime: '2026-05-30T14:30',
      intent: 'create_event',
      needsConfirmation: true,
      title: 'встреча с врачом',
    })
  })

  it('asks for clarification on empty commands', () => {
    const intent = parser.parse('Хаотика', { now: NOW })

    expect(intent.intent).toBe('clarify')
    expect(intent.clarificationQuestion).toBeTruthy()
  })
})

describe('reduceVoiceAssistantState', () => {
  it('moves transcript through parsing to confirmation and execution', () => {
    const transcript = 'добавь задачу купить хлеб'
    const parser = new PlannerIntentParser()
    const parsingState = reduceVoiceAssistantState(initialVoiceAssistantState, {
      source: 'web_microphone',
      transcript,
      type: 'transcript_received',
    })
    const awaitingState = reduceVoiceAssistantState(parsingState, {
      intent: parser.parse(transcript, { now: NOW }),
      type: 'intent_parsed',
    })
    const executingState = reduceVoiceAssistantState(awaitingState, {
      type: 'confirmed',
    })
    const completedState = reduceVoiceAssistantState(executingState, {
      type: 'executed',
    })

    expect(parsingState.status).toBe('parsing')
    expect(awaitingState.status).toBe('awaiting_confirmation')
    expect(executingState.status).toBe('executing')
    expect(completedState.status).toBe('completed')
  })

  it('does not execute without an awaiting confirmation state', () => {
    const nextState = reduceVoiceAssistantState(initialVoiceAssistantState, {
      type: 'confirmed',
    })

    expect(nextState).toBe(initialVoiceAssistantState)
  })
})
