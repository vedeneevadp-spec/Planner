import {
  canUseVoiceAssistant,
  initialVoiceAssistantState,
  type PlannerIntentName,
  PlannerIntentParser,
  reduceVoiceAssistantState,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import { shouldAutoConfirmPlannerIntent } from './planner-intent-execution'

const NOW = new Date('2026-05-28T06:00:00.000Z')
const SPHERES = [
  { id: 'home', name: 'дом' },
  { id: 'kids', name: 'дети' },
  { id: 'garden', name: 'сад' },
  { id: 'finance', name: 'финансы' },
  { id: 'work', name: 'работа' },
  { id: 'health', name: 'здоровье' },
]

describe('PlannerIntentParser', () => {
  const parser = new PlannerIntentParser()

  it('parses task creation with date and exact time', () => {
    const intent = parser.parse('завтра в 9 стоматолог', {
      now: NOW,
      spheres: SPHERES,
    })

    expect(intent).toMatchObject({
      confidence: 0.9,
      date: '2026-05-29',
      datePrecision: 'exact',
      intent: 'create_task',
      needsConfirmation: true,
      sphereId: 'health',
      time: '09:00',
      title: 'стоматолог',
    })
  })

  it('keeps dated buy wording as a task, not a shopping item', () => {
    const intent = parser.parse('завтра купить молоко', { now: NOW })

    expect(intent).toMatchObject({
      date: '2026-05-29',
      datePrecision: 'date_only',
      intent: 'create_task',
      needsConfirmation: true,
      title: 'купить молоко',
    })
  })

  it('removes date prepositions from task titles', () => {
    const todayIntent = parser.parse('добавь задачу заказать еду на сегодня', {
      now: NOW,
    })
    const tomorrowIntent = parser.parse('подготовить отчет к завтра', {
      now: NOW,
    })

    expect(todayIntent).toMatchObject({
      date: '2026-05-28',
      datePrecision: 'date_only',
      intent: 'create_task',
      title: 'заказать еду',
    })
    expect(tomorrowIntent).toMatchObject({
      date: '2026-05-29',
      datePrecision: 'date_only',
      intent: 'create_task',
      title: 'подготовить отчет',
    })
  })

  it('removes task command prefixes before title words', () => {
    const sttCaseIntent = parser.parse(
      'Добавь задача на сегодня пойти погулять',
      { now: NOW },
    )
    const barePrefixIntent = parser.parse('добавь позвонить врачу завтра', {
      now: NOW,
    })

    expect(sttCaseIntent).toMatchObject({
      date: '2026-05-28',
      datePrecision: 'date_only',
      intent: 'create_task',
      title: 'пойти погулять',
    })
    expect(barePrefixIntent).toMatchObject({
      date: '2026-05-29',
      datePrecision: 'date_only',
      intent: 'create_task',
      title: 'позвонить врачу',
    })
  })

  it('parses relative reminders as create_task with reminderAt', () => {
    const intent = parser.parse('через 10 минут выключить плиту', {
      now: NOW,
      spheres: SPHERES,
    })

    expect(intent).toMatchObject({
      datePrecision: 'relative',
      intent: 'create_task',
      needsConfirmation: false,
      reminderAt: '2026-05-28T09:10',
      sphereId: 'home',
      title: 'выключить плиту',
    })
  })

  it('normalizes conversational relative time', () => {
    const intent = parser.parse('через полчаса проверить духовку', {
      now: NOW,
      spheres: SPHERES,
    })

    expect(intent).toMatchObject({
      intent: 'create_task',
      needsConfirmation: false,
      reminderAt: '2026-05-28T09:30',
      title: 'проверить духовку',
    })
  })

  it('formats relative reminders in the parser context timezone', () => {
    const intent = parser.parse('Через полчаса проверить духовку', {
      now: '2026-05-29T06:54:00.000Z',
      timezone: 'Asia/Novosibirsk',
    })

    expect(intent).toMatchObject({
      intent: 'create_task',
      needsConfirmation: false,
      reminderAt: '2026-05-29T14:24',
      title: 'проверить духовку',
    })
  })

  it('parses multiple shopping items', () => {
    const intent = parser.parse('добавь молоко и хлеб в покупки', { now: NOW })
    const implicitBuyIntent = parser.parse('Надо купить соль сахар и мыло', {
      now: NOW,
    })

    expect(intent).toMatchObject({
      intent: 'add_shopping_item',
      items: [{ title: 'молоко' }, { title: 'хлеб' }],
      needsConfirmation: false,
    })
    expect(implicitBuyIntent).toMatchObject({
      intent: 'add_shopping_item',
      items: [{ title: 'соль' }, { title: 'сахар' }, { title: 'мыло' }],
      needsConfirmation: false,
    })
  })

  it('parses compact shopping lists and quantities', () => {
    const compact = parser.parse('купи хлеб яйца и яблоки', { now: NOW })
    const implicitSingleBuy = parser.parse('Надо купить хлеб', { now: NOW })
    const quantity = parser.parse(
      'Хаотика, добавь два молока и хлеб в покупки',
      {
        now: NOW,
      },
    )

    expect(compact).toMatchObject({
      intent: 'add_shopping_item',
      items: [{ title: 'хлеб' }, { title: 'яйца' }, { title: 'яблоки' }],
    })
    expect(implicitSingleBuy).toMatchObject({
      intent: 'add_shopping_item',
      items: [{ title: 'хлеб' }],
      needsConfirmation: false,
    })
    expect(quantity).toMatchObject({
      intent: 'add_shopping_item',
      items: [{ quantity: '2', title: 'молоко' }, { title: 'хлеб' }],
    })
  })

  it('parses reschedule as a dangerous intent without finding a task', () => {
    const intent = parser.parse('перенеси помыть окна на субботу', {
      now: NOW,
    })

    expect(intent).toMatchObject({
      date: '2026-05-30',
      datePrecision: 'date_only',
      intent: 'reschedule_task',
      isDangerous: true,
      needsConfirmation: true,
      targetQuery: 'помыть окна',
    })
  })

  it('parses agenda requests for today and tomorrow', () => {
    expect(parser.parse('что у меня сегодня', { now: NOW })).toMatchObject({
      date: '2026-05-28',
      datePrecision: 'exact',
      intent: 'get_agenda',
      needsConfirmation: false,
    })
    expect(parser.parse('что у меня завтра', { now: NOW })).toMatchObject({
      date: '2026-05-29',
      datePrecision: 'exact',
      intent: 'get_agenda',
      needsConfirmation: false,
    })
  })

  it('requires unlock for agenda and reschedule on a locked device', () => {
    expect(
      parser.parse('что у меня завтра', {
        isDeviceLocked: true,
        now: NOW,
      }),
    ).toMatchObject({
      intent: 'get_agenda',
      requiresUnlock: true,
    })
    expect(
      parser.parse('перенеси помыть окна на субботу', {
        isDeviceLocked: true,
        now: NOW,
      }),
    ).toMatchObject({
      intent: 'reschedule_task',
      requiresUnlock: true,
    })
  })

  it('keeps approximate periods and time ambiguity behind confirmation', () => {
    expect(
      parser.parse('в субботу утром помыть окна', { now: NOW }),
    ).toMatchObject({
      date: '2026-05-30',
      datePrecision: 'unknown',
      intent: 'create_task',
      needsConfirmation: true,
      time: '09:00',
      title: 'помыть окна',
    })
    expect(
      parser.parse('на следующей неделе записаться к врачу', {
        now: NOW,
        spheres: SPHERES,
      }),
    ).toMatchObject({
      date: '2026-06-01',
      datePrecision: 'period',
      intent: 'create_task',
      needsConfirmation: true,
      sphereId: 'health',
      title: 'записаться к врачу',
    })
    expect(parser.parse('завтра в 8 врач', { now: NOW })).toMatchObject({
      clarificationQuestion: 'В 8 утра или вечера?',
      datePrecision: 'unknown',
      intent: 'create_task',
      needsConfirmation: true,
      time: '08:00',
    })
  })

  it('marks unsupported dangerous delete commands without returning delete', () => {
    const intent = parser.parse('удали все задачи завтра', { now: NOW })

    expect(intent).toMatchObject({
      clarificationQuestion: 'Удаление голосом пока не поддерживается.',
      intent: 'unsupported',
      isDangerous: true,
      needsConfirmation: true,
    })
  })

  it('asks for clarification on empty and wake-word-only commands', () => {
    expect(parser.parse('', { now: NOW })).toMatchObject({
      intent: 'clarify',
    })
    expect(parser.parse('Хаотика', { now: NOW })).toMatchObject({
      intent: 'clarify',
    })
  })

  it('does not auto-confirm until visual undo is available', () => {
    const intent = parser.parse('через 10 минут выключить плиту', { now: NOW })

    expect(intent.needsConfirmation).toBe(false)
    expect(shouldAutoConfirmPlannerIntent(intent)).toBe(false)
  })

  it('covers at least 100 Russian command phrasings with deterministic rules', () => {
    const cases = createRussianPhraseCorpus()

    expect(cases.length).toBeGreaterThanOrEqual(100)

    for (const phraseCase of cases) {
      expect(parser.parse(phraseCase.text, { now: NOW }).intent).toBe(
        phraseCase.intent,
      )
    }
  })
})

describe('canUseVoiceAssistant', () => {
  it('enables voice only for global owner and test users', () => {
    expect(canUseVoiceAssistant('owner')).toBe(true)
    expect(canUseVoiceAssistant('test')).toBe(true)
    expect(canUseVoiceAssistant('admin')).toBe(false)
    expect(canUseVoiceAssistant('user')).toBe(false)
    expect(canUseVoiceAssistant('guest')).toBe(false)
    expect(canUseVoiceAssistant(null)).toBe(false)
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

function createRussianPhraseCorpus(): Array<{
  intent: PlannerIntentName
  text: string
}> {
  const taskTitles = [
    'позвонить врачу',
    'проверить оплату',
    'помыть окна',
    'записать кирилла на английский',
    'полить рассаду',
    'разобрать документы',
    'подготовить релиз',
    'убрать кухню',
    'купить грунт',
    'забрать заказ',
    'проверить банк',
    'сдать анализы',
    'написать отчет',
    'позвонить в школу',
    'починить кран',
    'отправить письмо',
    'проверить духовку',
    'выключить плиту',
    'заказать лекарства',
    'оплатить интернет',
  ]
  const shoppingItems = [
    'молоко',
    'хлеб',
    'яйца',
    'яблоки',
    'сыр',
    'чай',
    'кофе',
    'рис',
    'гречка',
    'масло',
    'кефир',
    'творог',
    'рыба',
    'мясо',
    'курица',
    'огурцы',
    'морковь',
    'сахар',
    'вода',
    'батон',
  ]
  const agendaPhrases = [
    'что у меня сегодня',
    'что у меня завтра',
    'какие задачи на сегодня',
    'какие задачи на завтра',
    'что запланировано на сегодня',
    'что запланировано на завтра',
    'покажи план сегодня',
    'покажи задачи завтра',
    'план на сегодня',
    'план на завтра',
  ]
  const rescheduleTitles = [
    'помыть окна',
    'проверить оплату',
    'позвонить врачу',
    'убрать кухню',
    'полить рассаду',
    'разобрать документы',
    'купить грунт',
    'отправить письмо',
    'забрать заказ',
    'сдать анализы',
  ]
  const unsupportedPhrases = [
    'удали задачу',
    'сотри все задачи',
    'стереть план на завтра',
    'убери все дела',
    'delete task',
  ]

  return [
    ...taskTitles.map((title) => ({
      intent: 'create_task' as const,
      text: `завтра ${title}`,
    })),
    ...taskTitles.map((title) => ({
      intent: 'create_task' as const,
      text: `в субботу ${title}`,
    })),
    ...taskTitles.map((title) => ({
      intent: 'create_task' as const,
      text: `через 10 минут ${title}`,
    })),
    ...shoppingItems.map((item) => ({
      intent: 'add_shopping_item' as const,
      text: `добавь ${item} в покупки`,
    })),
    ...shoppingItems.map((item) => ({
      intent: 'add_shopping_item' as const,
      text: `купи ${item}`,
    })),
    ...agendaPhrases.map((text) => ({
      intent: 'get_agenda' as const,
      text,
    })),
    ...rescheduleTitles.map((title) => ({
      intent: 'reschedule_task' as const,
      text: `перенеси ${title} на субботу`,
    })),
    ...unsupportedPhrases.map((text) => ({
      intent: 'unsupported' as const,
      text,
    })),
  ]
}
