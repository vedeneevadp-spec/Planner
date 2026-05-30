import type { VoiceTestContext } from './schema.js'

export const DEFAULT_VOICE_TEST_NOW = '2026-06-01T09:00:00+05:00'
export const DEFAULT_VOICE_TEST_TIMEZONE = 'Asia/Almaty'
export const DEFAULT_VOICE_TEST_LOCALE = 'ru-RU'

export const DEFAULT_VOICE_TEST_SPHERES = [
  {
    id: 'home',
    keywords: [
      'дом',
      'окна',
      'кухня',
      'кухню',
      'уборка',
      'плита',
      'духовка',
      'кран',
    ],
    name: 'Дом',
  },
  {
    id: 'kids',
    keywords: [
      'кирилл',
      'кирилла',
      'кирил',
      'максим',
      'максима',
      'макс',
      'школа',
      'школу',
      'английский',
    ],
    name: 'Дети',
  },
  {
    id: 'garden',
    keywords: ['рассада', 'рассаду', 'теплица', 'грунт', 'полить', 'сад'],
    name: 'Сад',
  },
  {
    id: 'health',
    keywords: [
      'врач',
      'врачу',
      'стоматолог',
      'стоматолога',
      'стамотолог',
      'лекарство',
      'лекарства',
      'анализы',
    ],
    name: 'Здоровье',
  },
  {
    id: 'finance',
    keywords: [
      'оплата',
      'оплату',
      'аплата',
      'аплату',
      'оплатить',
      'счет',
      'банк',
      'интернет',
    ],
    name: 'Финансы',
  },
  {
    id: 'work',
    keywords: ['созвон', 'релиз', 'проект', 'документы', 'отчет', 'письмо'],
    name: 'Работа',
  },
] satisfies NonNullable<VoiceTestContext['spheres']>

export const DEFAULT_TEST_CONTEXT = {
  appRole: 'owner',
  isDeviceLocked: false,
  locale: DEFAULT_VOICE_TEST_LOCALE,
  now: DEFAULT_VOICE_TEST_NOW,
  spheres: DEFAULT_VOICE_TEST_SPHERES,
  timezone: DEFAULT_VOICE_TEST_TIMEZONE,
} satisfies VoiceTestContext

export const LOCKED_TEST_CONTEXT = {
  ...DEFAULT_TEST_CONTEXT,
  isDeviceLocked: true,
} satisfies VoiceTestContext

export const TEST_ROLE_CONTEXTS = {
  admin: { ...DEFAULT_TEST_CONTEXT, appRole: 'admin' },
  guest: { ...DEFAULT_TEST_CONTEXT, appRole: 'guest' },
  owner: DEFAULT_TEST_CONTEXT,
  test: { ...DEFAULT_TEST_CONTEXT, appRole: 'test' },
  user: { ...DEFAULT_TEST_CONTEXT, appRole: 'user' },
} satisfies Record<
  'admin' | 'guest' | 'owner' | 'test' | 'user',
  VoiceTestContext
>
