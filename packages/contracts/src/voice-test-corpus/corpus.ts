import type { PlannerIntentName } from '../planner-intent.js'
import {
  DEFAULT_TEST_CONTEXT,
  LOCKED_TEST_CONTEXT,
  TEST_ROLE_CONTEXTS,
} from './fixtures.js'
import {
  type VoiceTestCase,
  voiceTestCaseSchema,
  type VoiceTestContext,
  type VoiceTestExpectedIntent,
  type VoiceTestExpectedPreview,
  type VoiceTestExpectedUi,
} from './schema.js'

export const VOICE_COMMAND_CORPUS_VERSION = 'voice-command-corpus.v1'

const TODAY = '2026-06-01'
const TOMORROW = '2026-06-02'
const AFTER_TOMORROW = '2026-06-03'
const FRIDAY = '2026-06-05'
const SATURDAY = '2026-06-06'
const NEXT_WEEK = '2026-06-08'

type ExpectedIntentInput = Partial<VoiceTestExpectedIntent> & {
  intent: PlannerIntentName
  needsConfirmation: boolean
}

type VoiceCaseInput = Omit<VoiceTestCase, 'context' | 'source'> & {
  context?: VoiceTestContext | undefined
  source?: VoiceTestCase['source'] | undefined
}

function expectedIntent(
  phrase: string,
  input: ExpectedIntentInput,
): VoiceTestExpectedIntent {
  return defined({
    confidence: input.confidence ?? defaultConfidence(input.intent),
    rawText: phrase,
    ...input,
  }) as VoiceTestExpectedIntent
}

function taskIntent(
  phrase: string,
  input: Omit<ExpectedIntentInput, 'intent' | 'needsConfirmation'> & {
    needsConfirmation?: boolean | undefined
    title: string
  },
): VoiceTestExpectedIntent {
  return expectedIntent(phrase, {
    ...input,
    intent: 'create_task',
    needsConfirmation: input.needsConfirmation ?? true,
  })
}

function shoppingIntent(
  phrase: string,
  items: Array<{ quantity?: string | undefined; title: string }>,
  input: Partial<ExpectedIntentInput> = {},
): VoiceTestExpectedIntent {
  return expectedIntent(phrase, {
    confidence: 0.94,
    intent: 'add_shopping_item',
    itemTitles: items.map((item) => item.title),
    items,
    needsConfirmation: false,
    requiresUnlock: false,
    ...input,
  })
}

function agendaIntent(
  phrase: string,
  date: string,
  input: Partial<ExpectedIntentInput> = {},
): VoiceTestExpectedIntent {
  return expectedIntent(phrase, {
    confidence: 0.95,
    date,
    datePrecision: 'exact',
    intent: 'get_agenda',
    needsConfirmation: false,
    ...input,
  })
}

function rescheduleIntent(
  phrase: string,
  input: Omit<
    ExpectedIntentInput,
    'intent' | 'isDangerous' | 'needsConfirmation'
  > & {
    targetQuery: string
  },
): VoiceTestExpectedIntent {
  return expectedIntent(phrase, {
    confidence: 0.85,
    intent: 'reschedule_task',
    isDangerous: true,
    needsConfirmation: true,
    targetQueryIncludes: input.targetQuery,
    ...input,
  })
}

function clarifyIntent(
  phrase: string,
  clarificationQuestion: string,
): VoiceTestExpectedIntent {
  return expectedIntent(phrase, {
    clarificationQuestion,
    confidence: 0.32,
    intent: 'clarify',
    needsConfirmation: false,
  })
}

function unsupportedIntent(
  phrase: string,
  input: Partial<ExpectedIntentInput> = {},
): VoiceTestExpectedIntent {
  return expectedIntent(phrase, {
    clarificationQuestion:
      'Пока я умею создавать задачи, добавлять покупки, переносить задачи и показывать план на сегодня или завтра.',
    confidence: 0.4,
    intent: 'unsupported',
    needsConfirmation: false,
    ...input,
  })
}

function defineCase(input: VoiceCaseInput): VoiceTestCase {
  return voiceTestCaseSchema.parse({
    context: DEFAULT_TEST_CONTEXT,
    llmFallbackAllowed: false,
    source: 'backend_text',
    ...input,
  })
}

function parserCase(
  input: Omit<VoiceCaseInput, 'expectedIntent'> & {
    expectedIntent: VoiceTestExpectedIntent
  },
): VoiceTestCase {
  return defineCase(input)
}

function preview(
  status: VoiceTestExpectedPreview['status'],
  options: Omit<VoiceTestExpectedPreview, 'status'> = {},
): VoiceTestExpectedPreview {
  return {
    status,
    ...options,
  }
}

function ui(
  card: VoiceTestExpectedUi['card'],
  options: Omit<VoiceTestExpectedUi, 'card'> = {},
): VoiceTestExpectedUi {
  return {
    card,
    ...options,
  }
}

function defaultConfidence(intent: PlannerIntentName): number {
  switch (intent) {
    case 'add_shopping_item':
      return 0.94
    case 'get_agenda':
      return 0.95
    case 'reschedule_task':
      return 0.85
    case 'clarify':
      return 0.32
    case 'unsupported':
      return 0.4
    case 'create_task':
      return 0.86
  }
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T
}

const taskUi = ui('task_confirmation', {
  buttons: ['Сохранить', 'Изменить', 'Отмена'],
  mustShow: ['Новая задача'],
})

const shoppingUi = ui('shopping_confirmation', {
  buttons: ['Добавить', 'Изменить', 'Отмена'],
  mustShow: ['Добавить в покупки'],
})

const wakeWordCases = [
  defineCase({
    category: 'wake_word',
    expectedAndroidRuntime: {
      commandRecordingAllowed: true,
      runtimeStatus: 'playing_listening_cue',
      uploadAllowed: false,
      wakeDetected: true,
    },
    expectedCue: { listening: 'play' },
    expectedMetrics: { events: ['wake_detected'] },
    expectedPrivacy: { uploadAllowed: false, mustNotLog: ['audio'] },
    id: 'wake_word_001',
    phrase: 'Хаотика',
    source: 'android_wake_word',
  }),
  ...(
    [
      ['wake_word_002', 'котика'],
      ['wake_word_003', 'готика'],
      ['wake_word_004', 'экзотика'],
      ['wake_word_005', 'хаос'],
      ['wake_word_006', 'хаотично'],
      ['wake_word_007', 'план на завтра'],
      ['wake_word_008', 'открой планнер'],
      ['wake_word_009', 'ха отика'],
    ] as const
  ).map(([id, phrase]) =>
    defineCase({
      category: 'wake_word',
      expectedAndroidRuntime: {
        commandRecordingAllowed: false,
        uploadAllowed: false,
        wakeDetected: false,
      },
      expectedCue: { listening: 'not_play' },
      expectedMetrics: { events: ['wake_hard_negative'] },
      expectedPrivacy: { uploadAllowed: false, mustNotLog: ['audio'] },
      id,
      phrase,
      source: 'android_wake_word',
    }),
  ),
  parserCase({
    category: 'wake_word',
    expectedCue: { listening: 'play', done: 'not_play' },
    expectedIntent: taskIntent('Хаотика, завтра позвонить врачу', {
      date: TOMORROW,
      datePrecision: 'date_only',
      sphereId: 'health',
      title: 'позвонить врачу',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: 'wake_word_010',
    phrase: 'Хаотика, завтра позвонить врачу',
    source: 'android_wake_word',
  }),
]

const createTaskCases = [
  [
    'task_basic_001',
    'завтра позвонить врачу',
    'позвонить врачу',
    TOMORROW,
    'date_only',
    undefined,
    'health',
  ],
  [
    'task_basic_002',
    'сегодня проверить оплату',
    'проверить оплату',
    TODAY,
    'date_only',
    undefined,
    'finance',
  ],
  [
    'task_basic_003',
    'послезавтра помыть окна',
    'помыть окна',
    AFTER_TOMORROW,
    'date_only',
    undefined,
    'home',
  ],
  [
    'task_basic_004',
    'в субботу убрать дом',
    'убрать дом',
    SATURDAY,
    'date_only',
    undefined,
    'home',
  ],
  [
    'task_basic_005',
    'на следующей неделе записаться к врачу',
    'записаться к врачу',
    NEXT_WEEK,
    'period',
    undefined,
    'health',
  ],
  [
    'task_basic_006',
    'записать Кирилла на английский',
    'кирилла на английский',
    undefined,
    undefined,
    undefined,
    'kids',
  ],
  [
    'task_basic_007',
    'записать Максима к врачу на пятницу',
    'максима к врачу',
    FRIDAY,
    'date_only',
    undefined,
    'health',
  ],
  [
    'task_basic_008',
    'добавь задачу позвонить врачу срочно',
    'позвонить врачу срочно',
    undefined,
    undefined,
    undefined,
    'health',
  ],
  [
    'task_basic_009',
    'проверить оплату за интернет завтра',
    'проверить оплату за интернет',
    TOMORROW,
    'date_only',
    undefined,
    'finance',
  ],
  [
    'task_basic_010',
    'создай задачу подготовить релиз на завтра',
    'подготовить релиз',
    TOMORROW,
    'date_only',
    undefined,
    'work',
  ],
  [
    'task_basic_011',
    'поставь задачу отправить письмо в пятницу',
    'отправить письмо',
    FRIDAY,
    'date_only',
    undefined,
    'work',
  ],
  [
    'task_basic_012',
    'надо разобрать документы в субботу',
    'разобрать документы',
    SATURDAY,
    'date_only',
    undefined,
    'work',
  ],
  [
    'task_basic_013',
    'нужно убрать кухню сегодня вечером',
    'убрать кухню',
    TODAY,
    'unknown',
    '19:00',
    'home',
  ],
  [
    'task_basic_014',
    'создай дело сдать анализы завтра утром',
    'сдать анализы',
    TOMORROW,
    'unknown',
    '09:00',
    'health',
  ],
  [
    'task_basic_015',
    'завтра в 9 стоматолог',
    'стоматолог',
    TOMORROW,
    'exact',
    '09:00',
    'health',
  ],
  [
    'task_basic_016',
    'завтра в 9 утра стоматолог',
    'стоматолог',
    TOMORROW,
    'exact',
    '09:00',
    'health',
  ],
  [
    'task_basic_017',
    'завтра в 9 вечера забрать заказ',
    'забрать заказ',
    TOMORROW,
    'exact',
    '21:00',
    undefined,
  ],
  [
    'task_basic_018',
    'сегодня в 21:30 проверить духовку',
    'проверить духовку',
    TODAY,
    'exact',
    '21:30',
    'home',
  ],
  [
    'task_basic_019',
    'завтра в 8 врач',
    'врач',
    TOMORROW,
    'unknown',
    '08:00',
    'health',
  ],
  [
    'task_basic_020',
    'создай задачу оплатить счет 05.06',
    'оплатить счет',
    FRIDAY,
    'date_only',
    undefined,
    'finance',
  ],
  [
    'task_basic_021',
    'добавь дело позвонить в школу завтра',
    'позвонить в школу',
    TOMORROW,
    'date_only',
    undefined,
    'kids',
  ],
  [
    'task_basic_022',
    'поставь задачу проверить банк сегодня',
    'проверить банк',
    TODAY,
    'date_only',
    undefined,
    'finance',
  ],
  [
    'task_basic_023',
    'запланируй починить кран в субботу',
    'починить кран',
    SATURDAY,
    'date_only',
    undefined,
    'home',
  ],
  [
    'task_basic_024',
    'внеси задачу заказать лекарства послезавтра',
    'заказать лекарства',
    AFTER_TOMORROW,
    'date_only',
    undefined,
    'health',
  ],
].map(([id, phrase, title, date, datePrecision, time, sphereId]) =>
  parserCase({
    category: 'create_task',
    expectedCue: { done: 'not_play' },
    expectedIntent: taskIntent(String(phrase), {
      ...(date ? { date: String(date) } : {}),
      ...(datePrecision
        ? {
            datePrecision: String(
              datePrecision,
            ) as VoiceTestExpectedIntent['datePrecision'],
          }
        : {}),
      ...(phrase === 'завтра в 8 врач'
        ? { clarificationQuestion: 'В 8 утра или вечера?', confidence: 0.76 }
        : {}),
      ...(sphereId ? { sphereId: String(sphereId) } : {}),
      ...(time ? { time: String(time) } : {}),
      title: String(title),
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI:
      id === 'task_basic_015'
        ? ui('task_confirmation', {
            buttons: ['Сохранить', 'Изменить', 'Отмена'],
            mustShow: ['Новая задача', 'стоматолог'],
          })
        : taskUi,
    id: String(id),
    phrase: String(phrase),
  }),
)

const reminderCases = [
  [
    'reminder_001',
    'через 10 минут выключить плиту',
    'выключить плиту',
    '2026-06-01T09:10',
    10,
    'home',
  ],
  [
    'reminder_002',
    'через полчаса проверить духовку',
    'проверить духовку',
    '2026-06-01T09:30',
    30,
    'home',
  ],
  [
    'reminder_003',
    'через час проверить суп',
    'проверить суп',
    '2026-06-01T10:00',
    60,
    undefined,
  ],
  [
    'reminder_004',
    'через 2 часа забрать белье',
    'забрать белье',
    '2026-06-01T11:00',
    120,
    undefined,
  ],
  [
    'reminder_005',
    'через 1 день оплатить интернет',
    'оплатить интернет',
    '2026-06-02T09:00',
    1440,
    'finance',
  ],
  [
    'reminder_006',
    'напомни через 15 минут принять лекарство',
    'принять лекарство',
    '2026-06-01T09:15',
    15,
    'health',
  ],
].map(([id, phrase, title, reminderAt, offset, sphereId]) =>
  parserCase({
    category: 'reminder_task',
    expectedCue: { done: 'not_play' },
    expectedIntent: taskIntent(String(phrase), {
      datePrecision: 'relative',
      needsConfirmation: false,
      reminderAt: String(reminderAt),
      reminderAtOffsetMinutes: Number(offset),
      ...(sphereId ? { sphereId: String(sphereId) } : {}),
      title: String(title),
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: ui('task_confirmation', {
      buttons: ['Сохранить', 'Изменить', 'Отмена'],
      mustShow: ['Напоминание-задача'],
    }),
    id: String(id),
    phrase: String(phrase),
  }),
)

const approximateReminderCases = [
  [
    'reminder_007',
    'напомни вечером полить рассаду',
    'полить рассаду',
    TODAY,
    '19:00',
    'garden',
  ],
  [
    'reminder_008',
    'завтра утром полить рассаду',
    'полить рассаду',
    TOMORROW,
    '09:00',
    'garden',
  ],
  [
    'reminder_009',
    'сегодня вечером проверить духовку',
    'проверить духовку',
    TODAY,
    '19:00',
    'home',
  ],
  [
    'reminder_010',
    'завтра днем позвонить врачу',
    'позвонить врачу',
    TOMORROW,
    '14:00',
    'health',
  ],
  [
    'reminder_011',
    'ночью проверить температуру',
    'проверить температуру',
    TODAY,
    '22:00',
    undefined,
  ],
  [
    'reminder_012',
    'утром отправить отчет',
    'отправить отчет',
    TODAY,
    '09:00',
    'work',
  ],
].map(([id, phrase, title, date, time, sphereId]) =>
  parserCase({
    category: 'reminder_task',
    expectedCue: { done: 'not_play' },
    expectedIntent: taskIntent(String(phrase), {
      date: String(date),
      datePrecision: 'unknown',
      ...(sphereId ? { sphereId: String(sphereId) } : {}),
      time: String(time),
      title: String(title),
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: String(id),
    phrase: String(phrase),
  }),
)

const shoppingCases = (
  [
    [
      'shopping_001',
      'добавь молоко и хлеб в покупки',
      [{ title: 'молоко' }, { title: 'хлеб' }],
    ],
    [
      'shopping_002',
      'добавь хлеб молоко и яблоки в покупки',
      [{ title: 'хлеб' }, { title: 'молоко' }, { title: 'яблоки' }],
    ],
    [
      'shopping_003',
      'купи хлеб яйца и яблоки',
      [{ title: 'хлеб' }, { title: 'яйца' }, { title: 'яблоки' }],
    ],
    [
      'shopping_004',
      'добавь два молока и хлеб',
      [{ quantity: '2', title: 'молоко' }, { title: 'хлеб' }],
    ],
    [
      'shopping_005',
      'добавь в список покупок корм для кота',
      [{ title: 'корм для кота' }],
    ],
    ['shopping_006', 'купи молоко', [{ title: 'молоко' }]],
    [
      'shopping_007',
      'надо купить соль сахар и мыло',
      [{ title: 'соль' }, { title: 'сахар' }, { title: 'мыло' }],
    ],
    ['shopping_008', 'добавь яйца в покупки', [{ title: 'яйца' }]],
    [
      'shopping_009',
      'добавь чай и кофе в покупки',
      [{ title: 'чай' }, { title: 'кофе' }],
    ],
    [
      'shopping_010',
      'добавь рис гречка в список покупок',
      [{ title: 'рис' }, { title: 'гречка' }],
    ],
    [
      'shopping_011',
      'мне нужно купить курица и овощи',
      [{ title: 'курица' }, { title: 'овощи' }],
    ],
    [
      'shopping_012',
      'добавь кефир и творог в покупки',
      [{ title: 'кефир' }, { title: 'творог' }],
    ],
    [
      'shopping_013',
      'купи воду и батон',
      [{ title: 'вода' }, { title: 'батон' }],
    ],
    [
      'shopping_014',
      'добавь масло сыр и йогурт в покупки',
      [{ title: 'масло' }, { title: 'сыр' }, { title: 'йогурт' }],
    ],
    [
      'shopping_015',
      'добавь морковь огурцы в покупки',
      [{ title: 'морковь' }, { title: 'огурцы' }],
    ],
    [
      'shopping_016',
      'добавь мясо и рыба в покупки',
      [{ title: 'мясо' }, { title: 'рыба' }],
    ],
    ['shopping_017', 'запиши молока в покупки', [{ title: 'молоко' }]],
    ['shopping_018', 'добавь сахар в список покупок', [{ title: 'сахар' }]],
  ] as const
).map(([id, phrase, items]) => {
  const expectedItems = items.map((item) => ({ ...item }))

  return parserCase({
    category: 'shopping',
    expectedCue: { done: 'not_play' },
    expectedIntent: shoppingIntent(phrase, expectedItems),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI:
      id === 'shopping_001'
        ? ui('shopping_confirmation', {
            buttons: ['Добавить', 'Изменить', 'Отмена'],
            mustShow: ['Добавить в покупки', 'молоко', 'хлеб'],
          })
        : shoppingUi,
    id,
    phrase,
  })
})

const agendaCases = [
  ['agenda_001', 'что у меня сегодня', TODAY],
  ['agenda_002', 'что у меня завтра', TOMORROW],
  ['agenda_003', 'какие задачи на сегодня', TODAY],
  ['agenda_004', 'какие задачи на завтра', TOMORROW],
  ['agenda_005', 'что запланировано на сегодня', TODAY],
  ['agenda_006', 'что запланировано на завтра', TOMORROW],
  ['agenda_007', 'покажи план сегодня', TODAY],
  ['agenda_008', 'покажи задачи завтра', TOMORROW],
  ['agenda_009', 'план на сегодня', TODAY],
  ['agenda_010', 'план на завтра', TOMORROW],
  ['agenda_011', 'покажи расписание сегодня', TODAY],
  ['agenda_012', 'покажи расписание завтра', TOMORROW],
].map(([id, phrase, date]) =>
  parserCase({
    category: 'agenda',
    expectedCue: { done: 'not_play' },
    expectedIntent: agendaIntent(String(phrase), String(date)),
    expectedPreview: preview('ready_for_confirmation', { canExecute: false }),
    expectedUI: ui('agenda', {
      buttons: ['Закрыть'],
      mustShow: ['План'],
    }),
    id: String(id),
    phrase: String(phrase),
  }),
)

const rescheduleCases = [
  [
    'reschedule_001',
    'перенеси помыть окна на субботу',
    'помыть окна',
    SATURDAY,
    'date_only',
    undefined,
    1,
  ],
  [
    'reschedule_002',
    'перенеси встречу на пятницу',
    'встречу',
    FRIDAY,
    'date_only',
    undefined,
    1,
  ],
  [
    'reschedule_003',
    'перенеси стоматолога на завтра в 11',
    'стоматолога',
    TOMORROW,
    'exact',
    '11:00',
    1,
  ],
  [
    'reschedule_004',
    'перенеси полить рассаду на вечер',
    'полить рассаду',
    TODAY,
    'unknown',
    '19:00',
    1,
  ],
  [
    'reschedule_005',
    'перепланируй проверить оплату на завтра',
    'проверить оплату',
    TOMORROW,
    'exact',
    undefined,
    1,
  ],
  [
    'reschedule_006',
    'сдвинь созвон на пятницу в 15:30',
    'созвон',
    FRIDAY,
    'exact',
    '15:30',
    1,
  ],
  [
    'reschedule_007',
    'перенеси задачу купить грунт на субботу',
    'купить грунт',
    SATURDAY,
    'date_only',
    undefined,
    1,
  ],
  [
    'reschedule_008',
    'перенеси отправить письмо на завтра утром',
    'отправить письмо',
    TOMORROW,
    'unknown',
    '09:00',
    1,
  ],
  [
    'reschedule_009',
    'перенеси забрать заказ на 05.06',
    'забрать заказ',
    FRIDAY,
    'exact',
    undefined,
    0,
  ],
  [
    'reschedule_010',
    'перенеси помыть окна на завтра',
    'помыть окна',
    TOMORROW,
    'exact',
    undefined,
    2,
  ],
  [
    'reschedule_011',
    'перенеси проверить банк на пятницу',
    'проверить банк',
    FRIDAY,
    'date_only',
    undefined,
    0,
  ],
  [
    'reschedule_012',
    'сдвинь сдать анализы на завтра',
    'сдать анализы',
    TOMORROW,
    'exact',
    undefined,
    1,
  ],
  [
    'reschedule_013',
    'перепланируй убрать кухню на субботу утром',
    'убрать кухню',
    SATURDAY,
    'unknown',
    '09:00',
    2,
  ],
  [
    'reschedule_014',
    'перенеси позвонить врачу на завтра в 8',
    'позвонить врачу',
    TOMORROW,
    'unknown',
    '08:00',
    1,
  ],
  [
    'reschedule_015',
    'перенеси оплатить интернет на пятницу',
    'оплатить интернет',
    FRIDAY,
    'date_only',
    undefined,
    1,
  ],
  [
    'reschedule_016',
    'сдвинь подготовить релиз на следующую неделю',
    'подготовить релиз',
    NEXT_WEEK,
    'period',
    undefined,
    1,
  ],
].map(
  ([id, phrase, targetQuery, date, datePrecision, time, candidateCount]) => {
    const status =
      candidateCount === 0
        ? 'not_found'
        : candidateCount === 2
          ? 'multiple_candidates'
          : 'ready_for_confirmation'
    const hasPrivateCandidateSurface =
      status === 'not_found' || status === 'multiple_candidates'

    return parserCase({
      category: 'reschedule',
      expectedCue: { done: 'not_play' },
      expectedIntent: rescheduleIntent(String(phrase), {
        ...(String(phrase).includes(' в 8')
          ? { clarificationQuestion: 'В 8 утра или вечера?', confidence: 0.72 }
          : {}),
        date: String(date),
        datePrecision: String(
          datePrecision,
        ) as VoiceTestExpectedIntent['datePrecision'],
        ...(time ? { time: String(time) } : {}),
        targetQuery: String(targetQuery),
      }),
      expectedPreview: preview(status, {
        canExecute: status === 'ready_for_confirmation',
        candidateCount: candidateCount as 0 | 1 | 2,
      }),
      expectedMetrics: hasPrivateCandidateSurface
        ? {
            events: ['voice_preview_shown'],
            mustNotIncludePrivateFields: true,
          }
        : undefined,
      expectedPrivacy: hasPrivateCandidateSurface
        ? {
            mustNotLog: [
              'transcript',
              'rawText',
              'title',
              'targetQuery',
              'taskTitle',
              'candidates',
            ],
          }
        : undefined,
      expectedUI:
        status === 'not_found'
          ? ui('not_found', {
              buttons: ['Создать новую', 'Изменить', 'Отмена'],
              mustNotShow: ['rawText', 'targetQuery', 'candidates'],
              mustShow: ['Задача не найдена'],
            })
          : status === 'multiple_candidates'
            ? ui('multiple_candidates', {
                buttons: ['Продолжить', 'Изменить', 'Отмена'],
                mustNotShow: ['rawText', 'targetQuery', 'candidates'],
                mustShow: ['Нашла несколько похожих задач'],
              })
            : ui('reschedule_confirmation', {
                buttons: ['Да, перенести', 'Изменить', 'Отмена'],
                mustShow: [
                  'Перенести задачу',
                  'Это изменит существующую задачу.',
                ],
              }),
      id: String(id),
      phrase: String(phrase),
    })
  },
)

const clarifyCases = [
  ['clarify_001', 'Хаотика', 'Что добавить в планер?'],
  ['clarify_002', 'добавь в покупки', 'Что добавить в покупки?'],
  ['clarify_003', 'перенеси встречу', 'Что и на какую дату перенести?'],
  ['clarify_004', 'перенеси на завтра', 'Что и на какую дату перенести?'],
  ['clarify_005', 'создай задачу завтра', 'Какую задачу создать?'],
  ['clarify_006', 'напомни через 10 минут', 'Какую задачу создать?'],
  ['clarify_007', 'добавь задачу', 'Какую задачу создать?'],
  ['clarify_008', 'поставь дело', 'Какую задачу создать?'],
  ['clarify_009', 'Хаотика, добавь в покупки', 'Что добавить в покупки?'],
  ['clarify_010', 'запиши в список покупок', 'Что добавить в покупки?'],
].map(([id, phrase, question]) =>
  parserCase({
    category: 'clarify',
    expectedCue: { done: 'not_play' },
    expectedIntent: clarifyIntent(String(phrase), String(question)),
    expectedPreview: preview('requires_clarification', { canExecute: false }),
    expectedUI:
      id === 'clarify_003'
        ? ui('clarify', {
            buttons: ['Повторить', 'Отмена'],
            mustShow: ['Нужно уточнение', 'Что и на какую дату перенести?'],
          })
        : ui('clarify', { buttons: ['Повторить', 'Отмена'] }),
    id: String(id),
    phrase: String(phrase),
  }),
)

const unsupportedCases = [
  'расскажи анекдот',
  'включи музыку',
  'отправь сообщение маме',
  'позвони врачу',
  'сколько времени',
  'найди рецепт блинов',
  'открой календарь',
  'покажи погоду',
  'включи будильник',
  'прочитай новости',
].map((phrase, index) =>
  parserCase({
    category: 'unsupported',
    expectedCue: { done: 'not_play' },
    expectedIntent: unsupportedIntent(phrase),
    expectedPreview: preview('unsupported', { canExecute: false }),
    expectedUI: ui('unsupported', {
      buttons: ['Отмена'],
      mustShow: ['Команда не поддерживается'],
    }),
    id: `unsupported_${String(index + 1).padStart(3, '0')}`,
    phrase,
  }),
)

const dangerousCases = [
  'удали задачу помыть окна',
  'удали все задачи на завтра',
  'сотри все задачи',
  'стереть план на завтра',
  'убери все дела',
  'удалить задачу стоматолог',
  'удаление задачи врач',
  'delete task',
  'удали все',
  'убери задачи на сегодня',
  'сотри задачу про оплату',
  'удали задачу',
].map((phrase, index) =>
  parserCase({
    category: 'dangerous',
    expectedCue: { done: 'not_play' },
    expectedIntent: unsupportedIntent(phrase, {
      clarificationQuestion: 'Удаление голосом пока не поддерживается.',
      confidence: 0.72,
      isDangerous: true,
      needsConfirmation: true,
    }),
    expectedPreview: preview('unsupported', { canExecute: false }),
    expectedUI:
      index === 0
        ? ui('unsupported', {
            buttons: ['Отмена'],
            mustNotShow: ['Подтвердить'],
            mustShow: [
              'Команда не поддерживается',
              'Опасные и массовые действия голосом сейчас не выполняются.',
            ],
          })
        : ui('unsupported', {
            buttons: ['Отмена'],
            mustNotShow: ['Подтвердить'],
          }),
    expectedPrivacy: {
      mustNotLog: [
        'transcript',
        'rawText',
        'title',
        'targetQuery',
        'taskTitle',
        'candidates',
      ],
    },
    id: `dangerous_${String(index + 1).padStart(3, '0')}`,
    phrase,
  }),
)

const lockedScreenCases = [
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: shoppingIntent('добавь молоко в покупки', [
      { title: 'молоко' },
    ]),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedPrivacy: { mustNotLog: ['transcript', 'shoppingItems'] },
    expectedUI: shoppingUi,
    id: 'locked_screen_001',
    phrase: 'добавь молоко в покупки',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: taskIntent('завтра позвонить врачу', {
      date: TOMORROW,
      datePrecision: 'date_only',
      sphereId: 'health',
      title: 'позвонить врачу',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedPrivacy: { mustNotLog: ['transcript', 'taskTitle'] },
    expectedUI: taskUi,
    id: 'locked_screen_002',
    phrase: 'завтра позвонить врачу',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: agendaIntent('что у меня завтра', TOMORROW, {
      requiresUnlock: true,
    }),
    expectedMetrics: {
      events: ['locked_screen_access_blocked'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('requires_unlock', { canExecute: false }),
    expectedPrivacy: {
      mustNotLog: ['audio', 'transcript', 'rawText', 'agendaItems'],
    },
    expectedUI: ui('requires_unlock', {
      buttons: ['Закрыть'],
      mustNotShow: ['что у меня завтра'],
      mustShow: ['Разблокируй телефон, чтобы продолжить.'],
    }),
    id: 'locked_screen_003',
    phrase: 'что у меня завтра',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: rescheduleIntent('перенеси помыть окна на субботу', {
      date: SATURDAY,
      datePrecision: 'date_only',
      requiresUnlock: true,
      targetQuery: 'помыть окна',
    }),
    expectedMetrics: {
      events: ['locked_screen_access_blocked'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('requires_unlock', { canExecute: false }),
    expectedPrivacy: {
      mustNotLog: [
        'audio',
        'transcript',
        'rawText',
        'title',
        'targetQuery',
        'taskTitle',
        'candidates',
      ],
    },
    expectedUI: ui('requires_unlock', {
      buttons: ['Закрыть'],
      mustNotShow: ['помыть окна'],
      mustShow: ['Разблокируй телефон, чтобы продолжить.'],
    }),
    id: 'locked_screen_004',
    phrase: 'перенеси помыть окна на субботу',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: unsupportedIntent('прочитай мое расписание'),
    expectedPreview: preview('unsupported', { canExecute: false }),
    expectedPrivacy: { mustNotLog: ['transcript', 'agendaItems'] },
    expectedUI: ui('unsupported', { buttons: ['Отмена'] }),
    id: 'locked_screen_005',
    phrase: 'прочитай мое расписание',
    source: 'android_wake_word',
  }),
  ...[
    ['locked_screen_006', 'что у меня сегодня', TODAY],
    ['locked_screen_007', 'покажи расписание завтра', TOMORROW],
    ['locked_screen_008', 'план на завтра', TOMORROW],
  ].map(([id, phrase, date]) =>
    parserCase({
      category: 'locked_screen',
      context: LOCKED_TEST_CONTEXT,
      expectedIntent: agendaIntent(String(phrase), String(date), {
        requiresUnlock: true,
      }),
      expectedPreview: preview('requires_unlock', { canExecute: false }),
      expectedPrivacy: {
        mustNotLog: ['transcript', 'agendaItems', 'rawText'],
      },
      expectedUI: ui('requires_unlock', {
        buttons: ['Закрыть'],
        mustShow: ['Разблокируй телефон, чтобы продолжить.'],
      }),
      id: String(id),
      phrase: String(phrase),
      source: 'android_wake_word',
    }),
  ),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: shoppingIntent('купи хлеб', [{ title: 'хлеб' }]),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedPrivacy: { mustNotLog: ['transcript', 'shoppingItems'] },
    expectedUI: shoppingUi,
    id: 'locked_screen_009',
    phrase: 'купи хлеб',
    source: 'android_push_to_talk',
  }),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: taskIntent('через 10 минут выключить плиту', {
      datePrecision: 'relative',
      needsConfirmation: false,
      reminderAt: '2026-06-01T09:10',
      sphereId: 'home',
      title: 'выключить плиту',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedPrivacy: { mustNotLog: ['transcript', 'taskTitle'] },
    expectedUI: taskUi,
    id: 'locked_screen_010',
    phrase: 'через 10 минут выключить плиту',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: unsupportedIntent('удали задачу', {
      clarificationQuestion: 'Удаление голосом пока не поддерживается.',
      confidence: 0.72,
      isDangerous: true,
      needsConfirmation: true,
      requiresUnlock: true,
    }),
    expectedPreview: preview('unsupported', { canExecute: false }),
    expectedPrivacy: { mustNotLog: ['transcript', 'taskTitle', 'rawText'] },
    expectedUI: ui('unsupported', { buttons: ['Отмена'] }),
    id: 'locked_screen_011',
    phrase: 'удали задачу',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'locked_screen',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: rescheduleIntent('перенеси встречу на пятницу', {
      date: FRIDAY,
      datePrecision: 'date_only',
      requiresUnlock: true,
      targetQuery: 'встречу',
    }),
    expectedPreview: preview('requires_unlock', { canExecute: false }),
    expectedPrivacy: { mustNotLog: ['transcript', 'candidates'] },
    expectedUI: ui('requires_unlock', {
      buttons: ['Отмена'],
      mustShow: ['Разблокируй телефон, чтобы продолжить.'],
    }),
    id: 'locked_screen_012',
    phrase: 'перенеси встречу на пятницу',
    source: 'android_wake_word',
  }),
]

const sttErrorCases = [
  parserCase({
    category: 'stt_error',
    expectedIntent: taskIntent('палить рассаду вечером', {
      date: TODAY,
      datePrecision: 'unknown',
      sphereId: 'garden',
      time: '19:00',
      title: 'палить рассаду',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: ui('task_confirmation', {
      buttons: ['Сохранить', 'Изменить', 'Отмена'],
      mustShow: ['Изменить'],
    }),
    id: 'stt_error_001',
    llmFallbackAllowed: true,
    phrase: 'палить рассаду вечером',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: taskIntent('макс им к врачу завтра', {
      date: TOMORROW,
      datePrecision: 'date_only',
      sphereId: 'health',
      title: 'макс им к врачу',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: 'stt_error_002',
    phrase: 'макс им к врачу завтра',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: unsupportedIntent('кирил на английский'),
    expectedPreview: preview('unsupported', { canExecute: false }),
    expectedUI: ui('unsupported', { buttons: ['Отмена'] }),
    id: 'stt_error_003',
    phrase: 'кирил на английский',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: taskIntent('проверить аплату завтра', {
      date: TOMORROW,
      datePrecision: 'date_only',
      sphereId: 'finance',
      title: 'проверить аплату',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: 'stt_error_004',
    phrase: 'проверить аплату завтра',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: taskIntent('стамотолог завтра в девять', {
      date: TOMORROW,
      datePrecision: 'exact',
      sphereId: 'health',
      time: '09:00',
      title: 'стамотолог',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: 'stt_error_005',
    phrase: 'стамотолог завтра в девять',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: taskIntent('хаотика завтра позвонить врачу', {
      date: TOMORROW,
      datePrecision: 'date_only',
      sphereId: 'health',
      title: 'позвонить врачу',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: 'stt_error_006',
    phrase: 'хаотика завтра позвонить врачу',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: shoppingIntent('добавь малако и хлеб в покупки', [
      { title: 'малако' },
      { title: 'хлеб' },
    ]),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: shoppingUi,
    id: 'stt_error_007',
    llmFallbackAllowed: true,
    phrase: 'добавь малако и хлеб в покупки',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: taskIntent('завтра купить малако', {
      date: TOMORROW,
      datePrecision: 'date_only',
      title: 'купить малако',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: 'stt_error_008',
    llmFallbackAllowed: true,
    phrase: 'завтра купить малако',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: rescheduleIntent('перенеси памыть окна на субботу', {
      date: SATURDAY,
      datePrecision: 'date_only',
      targetQuery: 'памыть окна',
    }),
    expectedPreview: preview('not_found', {
      canExecute: false,
      candidateCount: 0,
    }),
    expectedUI: ui('not_found', {
      buttons: ['Создать новую', 'Изменить', 'Отмена'],
    }),
    id: 'stt_error_009',
    phrase: 'перенеси памыть окна на субботу',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: agendaIntent('что у меня зафтра', TODAY, {
      confidence: 0.82,
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: false }),
    expectedUI: ui('agenda'),
    id: 'stt_error_010',
    phrase: 'что у меня зафтра',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: shoppingIntent('добавь хлеб и я блоки в покупки', [
      { title: 'хлеб' },
      { title: 'я блоки' },
    ]),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: shoppingUi,
    id: 'stt_error_011',
    llmFallbackAllowed: true,
    phrase: 'добавь хлеб и я блоки в покупки',
  }),
  parserCase({
    category: 'stt_error',
    expectedIntent: taskIntent('через десять минут выключить плиту', {
      datePrecision: 'relative',
      needsConfirmation: false,
      reminderAt: '2026-06-01T09:10',
      sphereId: 'home',
      title: 'выключить плиту',
    }),
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    id: 'stt_error_012',
    phrase: 'через десять минут выключить плиту',
  }),
]

const voiceCueCases = [
  [
    'voice_cue_001',
    'wake detected',
    'android_wake_word',
    'play',
    'not_play',
    ['wake_detected'],
  ],
  [
    'voice_cue_002',
    'android push-to-talk start',
    'android_push_to_talk',
    'play',
    'not_play',
    ['android_push_to_talk_started'],
  ],
  [
    'voice_cue_003',
    'web push-to-talk start',
    'web_push_to_talk',
    'not_play',
    'not_play',
    ['web_voice_started'],
  ],
  [
    'voice_cue_004',
    'successful create_task execute',
    'android_wake_word',
    undefined,
    'play',
    ['voice_action_executed'],
  ],
  [
    'voice_cue_005',
    'successful add_shopping_item execute',
    'android_push_to_talk',
    undefined,
    'play',
    ['voice_action_executed'],
  ],
  [
    'voice_cue_006',
    'successful reschedule execute',
    'android_wake_word',
    undefined,
    'play',
    ['voice_action_executed'],
  ],
  [
    'voice_cue_007',
    'get_agenda success',
    'android_wake_word',
    undefined,
    'not_play',
    ['voice_agenda_shown'],
  ],
  [
    'voice_cue_008',
    'preview only',
    'android_wake_word',
    undefined,
    'not_play',
    ['voice_preview_shown'],
  ],
  [
    'voice_cue_009',
    'clarify response',
    'android_wake_word',
    undefined,
    'not_play',
    ['voice_clarify_shown'],
  ],
  [
    'voice_cue_010',
    'requires unlock response',
    'android_wake_word',
    undefined,
    'not_play',
    ['locked_screen_access_blocked'],
  ],
  [
    'voice_cue_011',
    'error response',
    'android_wake_word',
    undefined,
    'not_play',
    ['voice_error'],
  ],
  [
    'voice_cue_012',
    'undo success',
    'android_wake_word',
    undefined,
    'not_play',
    ['voice_action_undo_success'],
  ],
].map(([id, phrase, source, listening, done, events]) =>
  defineCase({
    category: 'voice_cue',
    expectedCue: defined({
      done,
      listening,
    }) as VoiceTestCase['expectedCue'],
    expectedMetrics: { events: events as string[] },
    expectedPrivacy: { mustNotLog: ['transcript', 'rawText', 'taskTitle'] },
    id: String(id),
    phrase: String(phrase),
    source: source as VoiceTestCase['source'],
  }),
)

const webFlowCases = [
  defineCase({
    category: 'web_flow',
    expectedMetrics: { events: ['web_voice_upload_started'] },
    expectedPrivacy: { uploadAllowed: true, mustNotLog: ['audio'] },
    expectedWebFlow: { outcome: 'upload', uploadExpected: true },
    id: 'web_flow_001',
    phrase: 'web secure context + mic allowed',
    source: 'web_push_to_talk',
  }),
  defineCase({
    category: 'web_flow',
    expectedPreview: preview('unsupported', { canExecute: false }),
    expectedWebFlow: {
      outcome: 'unsupported',
      reason: 'insecure_context',
      uploadExpected: false,
    },
    id: 'web_flow_002',
    phrase: 'web insecure context',
    source: 'web_push_to_talk',
  }),
  defineCase({
    category: 'web_flow',
    expectedWebFlow: {
      outcome: 'unsupported',
      reason: 'get_user_media_unavailable',
      uploadExpected: false,
    },
    id: 'web_flow_003',
    phrase: 'getUserMedia missing',
    source: 'web_push_to_talk',
  }),
  defineCase({
    category: 'web_flow',
    expectedWebFlow: {
      outcome: 'unsupported',
      reason: 'media_recorder_unavailable',
      uploadExpected: false,
    },
    id: 'web_flow_004',
    phrase: 'MediaRecorder missing',
    source: 'web_push_to_talk',
  }),
  defineCase({
    category: 'web_flow',
    expectedMetrics: { events: ['web_voice_permission_denied'] },
    expectedWebFlow: {
      outcome: 'permission_denied',
      reason: 'NotAllowedError',
      uploadExpected: false,
    },
    id: 'web_flow_005',
    phrase: 'permission denied',
    source: 'web_push_to_talk',
  }),
  ...[
    ['web_flow_006', 'too short audio', 'too_short'],
    ['web_flow_007', 'silent audio', 'silent_audio'],
    ['web_flow_008', 'too quiet audio', 'too_quiet'],
  ].map(([id, phrase, reason]) =>
    defineCase({
      category: 'web_flow',
      expectedMetrics: { events: ['web_voice_local_validation_failed'] },
      expectedPrivacy: { uploadAllowed: false, mustNotLog: ['audio'] },
      expectedWebFlow: {
        outcome: 'needs_repeat',
        reason: String(reason),
        uploadExpected: false,
      },
      id: String(id),
      phrase: String(phrase),
      source: 'web_push_to_talk',
    }),
  ),
  defineCase({
    category: 'web_flow',
    expectedMetrics: { events: ['web_voice_recording_cancelled'] },
    expectedPrivacy: { uploadAllowed: false, mustNotLog: ['audio'] },
    expectedWebFlow: { outcome: 'cancelled', uploadExpected: false },
    id: 'web_flow_009',
    phrase: 'cancel recording',
    source: 'web_push_to_talk',
  }),
  defineCase({
    category: 'web_flow',
    expectedMetrics: { events: ['web_voice_timeout'] },
    expectedWebFlow: { outcome: 'timeout', uploadExpected: false },
    id: 'web_flow_010',
    phrase: 'timeout',
    source: 'web_push_to_talk',
  }),
  parserCase({
    category: 'web_flow',
    expectedIntent: taskIntent('завтра купить молоко', {
      date: TOMORROW,
      datePrecision: 'date_only',
      title: 'купить молоко',
    }),
    expectedMetrics: { events: ['web_voice_upload_completed'] },
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: taskUi,
    expectedWebFlow: { outcome: 'upload', uploadExpected: true },
    id: 'web_flow_011',
    phrase: 'завтра купить молоко',
    source: 'web_push_to_talk',
  }),
  parserCase({
    category: 'web_flow',
    expectedIntent: shoppingIntent('добавь молоко и хлеб в покупки', [
      { title: 'молоко' },
      { title: 'хлеб' },
    ]),
    expectedMetrics: { events: ['web_voice_upload_completed'] },
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedUI: shoppingUi,
    expectedWebFlow: { outcome: 'upload', uploadExpected: true },
    id: 'web_flow_012',
    phrase: 'добавь молоко и хлеб в покупки',
    source: 'web_push_to_talk',
  }),
]

const androidRuntimeCases = [
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      commandRecordingAllowed: true,
      runtimeStatus: 'playing_listening_cue',
      uploadAllowed: false,
      wakeDetected: true,
    },
    expectedCue: { listening: 'play' },
    id: 'android_runtime_001',
    phrase: 'Хаотика',
    source: 'android_wake_word',
  }),
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      commandRecordingAllowed: false,
      uploadAllowed: false,
      wakeDetected: false,
    },
    expectedCue: { listening: 'not_play' },
    id: 'android_runtime_002',
    phrase: 'котика',
    source: 'android_wake_word',
  }),
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      commandRecordingAllowed: true,
      runtimeStatus: 'recording_command',
      uploadAllowed: true,
    },
    expectedCue: { listening: 'play' },
    id: 'android_runtime_003',
    phrase: 'нажата кнопка микрофона',
    source: 'android_push_to_talk',
  }),
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      commandRecordingAllowed: false,
      runtimeStatus: 'listening_wake_word',
      uploadAllowed: false,
      wakeDetected: false,
    },
    id: 'android_runtime_004',
    phrase: 'фоновый шум до wake word',
    source: 'android_wake_word',
  }),
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      commandRecordingAllowed: true,
      runtimeStatus: 'recording_command',
      uploadAllowed: true,
    },
    expectedMetrics: { events: ['command_recorder_start_latency_ms'] },
    id: 'android_runtime_005',
    phrase: 'короткая команда после wake word',
    source: 'android_wake_word',
  }),
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      commandRecordingAllowed: false,
      runtimeStatus: 'blocked',
      uploadAllowed: false,
    },
    expectedMetrics: { events: ['wake_engine_error'] },
    id: 'android_runtime_006',
    phrase: 'wake model missing',
    source: 'android_wake_word',
  }),
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      commandRecordingAllowed: false,
      runtimeStatus: 'blocked',
      uploadAllowed: false,
    },
    expectedMetrics: { events: ['graceful_degradation_used'] },
    id: 'android_runtime_007',
    phrase: 'microphone permission revoked',
    source: 'android_push_to_talk',
  }),
  defineCase({
    category: 'android_runtime',
    expectedAndroidRuntime: {
      settingsPersisted: true,
    },
    expectedCue: { done: 'not_play', listening: 'not_play' },
    id: 'android_runtime_008',
    phrase: 'voice cues setting persisted',
    source: 'android_push_to_talk',
  }),
]

const privacySecurityCases = [
  parserCase({
    category: 'privacy_security',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: agendaIntent('что у меня завтра', TOMORROW, {
      requiresUnlock: true,
    }),
    expectedMetrics: {
      events: ['locked_screen_access_blocked'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('requires_unlock', { canExecute: false }),
    expectedPrivacy: {
      mustNotLog: ['audio', 'transcript', 'rawText', 'agendaItems'],
    },
    expectedUI: ui('requires_unlock', {
      buttons: ['Закрыть'],
      mustNotShow: ['что у меня завтра'],
      mustShow: ['Разблокируй телефон, чтобы продолжить.'],
    }),
    id: 'privacy_security_001',
    phrase: 'что у меня завтра',
    source: 'android_wake_word',
  }),
  parserCase({
    category: 'privacy_security',
    context: LOCKED_TEST_CONTEXT,
    expectedIntent: rescheduleIntent('перенеси секретный договор на завтра', {
      date: TOMORROW,
      datePrecision: 'exact',
      requiresUnlock: true,
      targetQuery: 'секретный договор',
    }),
    expectedMetrics: {
      events: ['locked_screen_access_blocked'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('requires_unlock', { canExecute: false }),
    expectedPrivacy: {
      mustNotLog: [
        'audio',
        'transcript',
        'rawText',
        'title',
        'targetQuery',
        'taskTitle',
        'candidates',
      ],
    },
    expectedUI: ui('requires_unlock', {
      buttons: ['Закрыть'],
      mustNotShow: ['секретный договор'],
      mustShow: ['Разблокируй телефон, чтобы продолжить.'],
    }),
    id: 'privacy_security_002',
    phrase: 'перенеси секретный договор на завтра',
    source: 'android_wake_word',
  }),
  ...(
    [
      {
        context: TEST_ROLE_CONTEXTS.admin,
        id: 'privacy_security_003',
        role: 'admin',
      },
      {
        context: TEST_ROLE_CONTEXTS.user,
        id: 'privacy_security_004',
        role: 'user',
      },
      {
        context: TEST_ROLE_CONTEXTS.guest,
        id: 'privacy_security_005',
        role: 'guest',
      },
    ] as const
  ).map(({ context, id, role }) =>
    parserCase({
      category: 'privacy_security',
      context,
      expectedIntent: taskIntent(`завтра проверить оплату ${role}`, {
        date: TOMORROW,
        datePrecision: 'date_only',
        sphereId: 'finance',
        title: `проверить оплату ${role}`,
      }),
      expectedMetrics: {
        events: ['voice_feature_forbidden'],
        mustNotIncludePrivateFields: true,
      },
      expectedPreview: preview('blocked', { canExecute: false }),
      expectedPrivacy: { mustNotLog: ['transcript', 'taskTitle'] },
      expectedUI: ui('blocked', {
        mustShow: ['Это действие сейчас недоступно'],
      }),
      id,
      phrase: `завтра проверить оплату ${role}`,
      source: 'backend_text',
    }),
  ),
  parserCase({
    category: 'privacy_security',
    expectedIntent: shoppingIntent('добавь молоко и хлеб в покупки', [
      { title: 'молоко' },
      { title: 'хлеб' },
    ]),
    expectedMetrics: {
      events: ['voice_preview_shown'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedPrivacy: { mustNotLog: ['shoppingItems', 'rawText'] },
    expectedUI: shoppingUi,
    id: 'privacy_security_006',
    phrase: 'добавь молоко и хлеб в покупки',
  }),
  parserCase({
    category: 'privacy_security',
    expectedIntent: agendaIntent('что у меня сегодня', TODAY),
    expectedMetrics: {
      events: ['voice_agenda_shown'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('ready_for_confirmation', { canExecute: false }),
    expectedPrivacy: { mustNotLog: ['agendaItems', 'rawText'] },
    expectedUI: ui('agenda'),
    id: 'privacy_security_007',
    phrase: 'что у меня сегодня',
  }),
  defineCase({
    category: 'privacy_security',
    expectedAndroidRuntime: { uploadAllowed: false, wakeDetected: false },
    expectedMetrics: {
      events: ['wake_hard_negative'],
      mustNotIncludePrivateFields: true,
    },
    expectedPrivacy: { uploadAllowed: false, mustNotLog: ['audio'] },
    id: 'privacy_security_008',
    phrase: 'экзотика',
    source: 'android_wake_word',
  }),
  defineCase({
    category: 'privacy_security',
    expectedMetrics: {
      events: ['web_voice_local_validation_failed'],
      mustNotIncludePrivateFields: true,
    },
    expectedPrivacy: { uploadAllowed: false, mustNotLog: ['audio'] },
    expectedWebFlow: {
      outcome: 'needs_repeat',
      reason: 'silent_audio',
      uploadExpected: false,
    },
    id: 'privacy_security_009',
    phrase: 'silent web audio',
    source: 'web_push_to_talk',
  }),
  parserCase({
    category: 'privacy_security',
    expectedIntent: unsupportedIntent('удали все задачи завтра', {
      clarificationQuestion: 'Удаление голосом пока не поддерживается.',
      confidence: 0.72,
      isDangerous: true,
      needsConfirmation: true,
    }),
    expectedMetrics: {
      events: ['dangerous_voice_action_blocked'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('unsupported', { canExecute: false }),
    expectedPrivacy: {
      mustNotLog: [
        'transcript',
        'rawText',
        'title',
        'targetQuery',
        'taskTitle',
        'candidates',
      ],
    },
    expectedUI: ui('unsupported', { mustNotShow: ['Подтвердить'] }),
    id: 'privacy_security_010',
    phrase: 'удали все задачи завтра',
  }),
  parserCase({
    category: 'privacy_security',
    expectedIntent: taskIntent('хаотика завтра позвонить врачу', {
      date: TOMORROW,
      datePrecision: 'date_only',
      sphereId: 'health',
      title: 'позвонить врачу',
    }),
    expectedMetrics: {
      events: ['voice_preview_shown'],
      mustNotIncludePrivateFields: true,
    },
    expectedPreview: preview('ready_for_confirmation', { canExecute: true }),
    expectedPrivacy: { mustNotLog: ['rawText', 'taskTitle'] },
    expectedUI: taskUi,
    id: 'privacy_security_011',
    phrase: 'хаотика завтра позвонить врачу',
    source: 'android_wake_word',
  }),
  defineCase({
    category: 'privacy_security',
    expectedMetrics: {
      events: ['voice_action_undo_success'],
      mustNotIncludePrivateFields: true,
    },
    expectedPrivacy: { mustNotLog: ['transcript', 'taskTitle'] },
    id: 'privacy_security_012',
    phrase: 'undo success telemetry',
    source: 'android_push_to_talk',
  }),
]

const rawVoiceCommandCorpusV1 = [
  ...wakeWordCases,
  ...createTaskCases,
  ...reminderCases,
  ...approximateReminderCases,
  ...shoppingCases,
  ...agendaCases,
  ...rescheduleCases,
  ...clarifyCases,
  ...unsupportedCases,
  ...dangerousCases,
  ...lockedScreenCases,
  ...sttErrorCases,
  ...voiceCueCases,
  ...webFlowCases,
  ...androidRuntimeCases,
  ...privacySecurityCases,
]

export const voiceCommandCorpusV1 = rawVoiceCommandCorpusV1.map((testCase) =>
  voiceTestCaseSchema.parse(testCase),
)
