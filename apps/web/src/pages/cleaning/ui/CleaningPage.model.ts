import {
  type CleaningAssignee,
  type CleaningDepth,
  type CleaningEnergy,
  type CleaningFrequencyType,
  type CleaningPriority,
  type CleaningTaskRecord,
  type CleaningTaskWithState,
  type CleaningTodayResponse,
  type NewCleaningTaskInput,
} from '@planner/contracts'

import { getCleaningErrorMessage } from '@/features/cleaning'

export type FocusMode = 'all' | 'quick' | 'minimum' | 'regular' | 'deep'

export interface TaskDraft {
  assignee: CleaningAssignee
  customIntervalDays: string
  depth: CleaningDepth
  description: string
  energy: CleaningEnergy
  estimatedMinutes: string
  frequencyInterval: string
  frequencyType: CleaningFrequencyType
  impactScore: string
  isSeasonal: boolean
  priority: CleaningPriority
  seasonMonths: number[]
  tags: string
  title: string
}

interface ZoneTemplate {
  dayOfWeek: number
  description: string
  tasks: Array<Omit<NewCleaningTaskInput, 'zoneId'>>
  title: string
}

export const WEEKDAYS = [
  { label: 'Понедельник', shortLabel: 'Пн', value: 1 },
  { label: 'Вторник', shortLabel: 'Вт', value: 2 },
  { label: 'Среда', shortLabel: 'Ср', value: 3 },
  { label: 'Четверг', shortLabel: 'Чт', value: 4 },
  { label: 'Пятница', shortLabel: 'Пт', value: 5 },
  { label: 'Суббота', shortLabel: 'Сб', value: 6 },
  { label: 'Воскресенье', shortLabel: 'Вс', value: 7 },
] as const

export type WeekdayOption = (typeof WEEKDAYS)[number]

export const MONTHS = [
  { label: 'Янв', value: 1 },
  { label: 'Фев', value: 2 },
  { label: 'Мар', value: 3 },
  { label: 'Апр', value: 4 },
  { label: 'Май', value: 5 },
  { label: 'Июн', value: 6 },
  { label: 'Июл', value: 7 },
  { label: 'Авг', value: 8 },
  { label: 'Сен', value: 9 },
  { label: 'Окт', value: 10 },
  { label: 'Ноя', value: 11 },
  { label: 'Дек', value: 12 },
] as const

export const PRIORITY_LABELS: Record<CleaningPriority, string> = {
  high: 'важно',
  low: 'низкий',
  normal: 'обычно',
}

export const DEPTH_LABELS: Record<CleaningDepth, string> = {
  deep: 'генеральная',
  minimum: 'минимум',
  regular: 'обычная',
}

export const ENERGY_LABELS: Record<CleaningEnergy, string> = {
  high: 'много сил',
  low: 'мало сил',
  normal: 'нормально',
}

export const ASSIGNEE_LABELS: Record<CleaningAssignee, string> = {
  anyone: 'любой',
  child: 'ребёнок',
  partner: 'партнёр',
  self: 'я',
}

export const FREQUENCY_LABELS: Record<CleaningFrequencyType, string> = {
  custom: 'раз в N дней',
  monthly: 'раз в N месяцев',
  weekly: 'раз в N недель',
}

export const EMPTY_TASK_DRAFT: TaskDraft = {
  assignee: 'anyone',
  customIntervalDays: '10',
  depth: 'regular',
  description: '',
  energy: 'normal',
  estimatedMinutes: '15',
  frequencyInterval: '1',
  frequencyType: 'weekly',
  impactScore: '3',
  isSeasonal: false,
  priority: 'normal',
  seasonMonths: [],
  tags: '',
  title: '',
}

export const DEFAULT_CLEANING_TEMPLATES: ZoneTemplate[] = [
  {
    dayOfWeek: 1,
    description: 'Поверхности, продукты, техника и запас чистой посуды.',
    title: 'Кухня',
    tasks: [
      templateTask('Протереть столешницу', 10, 'normal', 'minimum', 'low'),
      templateTask('Помыть плиту', 15, 'normal', 'regular', 'normal'),
      templateTask('Проверить просрочку', 10, 'normal', 'minimum', 'low'),
      templateTask('Разобрать продукты', 20, 'normal', 'regular', 'normal'),
      templateTask('Помыть холодильник', 30, 'high', 'deep', 'normal', {
        frequencyInterval: 1,
        frequencyType: 'monthly',
      }),
      templateTask('Помыть духовку', 45, 'normal', 'deep', 'high', {
        frequencyInterval: 2,
        frequencyType: 'monthly',
      }),
    ],
  },
  {
    dayOfWeek: 2,
    description: 'Сантехника, зеркала, расходники и короткая влажная уборка.',
    title: 'Ванная / туалет',
    tasks: [
      templateTask('Почистить раковину', 10, 'normal', 'minimum', 'low'),
      templateTask('Помыть зеркало', 10, 'normal', 'minimum', 'low'),
      templateTask('Почистить ванну или душ', 20, 'high', 'regular', 'normal'),
      templateTask('Проверить бытовую химию', 10, 'low', 'regular', 'low'),
      templateTask('Постирать коврики', 30, 'normal', 'deep', 'normal', {
        frequencyInterval: 2,
        frequencyType: 'weekly',
      }),
    ],
  },
  {
    dayOfWeek: 3,
    description: 'Постель, поверхности, вещи и спокойный порядок.',
    title: 'Спальня',
    tasks: [
      templateTask('Поменять постельное бельё', 15, 'normal', 'regular', 'low'),
      templateTask(
        'Протереть прикроватные поверхности',
        10,
        'normal',
        'minimum',
        'low',
      ),
      templateTask(
        'Разобрать одежду на стуле',
        15,
        'high',
        'regular',
        'normal',
      ),
      templateTask(
        'Пропылесосить под кроватью',
        25,
        'normal',
        'deep',
        'normal',
        {
          frequencyInterval: 2,
          frequencyType: 'weekly',
        },
      ),
    ],
  },
  {
    dayOfWeek: 4,
    description: 'Игрушки, одежда, рабочее место и вещи на местах.',
    title: 'Детская',
    tasks: [
      templateTask(
        'Собрать игрушки по корзинам',
        15,
        'normal',
        'minimum',
        'low',
        {
          assignee: 'child',
        },
      ),
      templateTask('Протереть стол', 10, 'normal', 'minimum', 'low', {
        assignee: 'child',
      }),
      templateTask(
        'Разобрать маленькую одежду',
        30,
        'normal',
        'deep',
        'normal',
        {
          frequencyInterval: 1,
          frequencyType: 'monthly',
        },
      ),
      templateTask('Пропылесосить', 20, 'normal', 'regular', 'normal'),
    ],
  },
  {
    dayOfWeek: 5,
    description: 'Общая зона, техника, текстиль и видимые поверхности.',
    title: 'Гостиная',
    tasks: [
      templateTask('Убрать видимый беспорядок', 10, 'normal', 'minimum', 'low'),
      templateTask('Протереть пыль', 15, 'normal', 'regular', 'normal'),
      templateTask('Пропылесосить ковёр', 20, 'normal', 'regular', 'normal'),
      templateTask('Разобрать журнальный столик', 10, 'low', 'minimum', 'low'),
      templateTask('Постирать пледы', 40, 'normal', 'deep', 'normal', {
        frequencyInterval: 1,
        frequencyType: 'monthly',
      }),
    ],
  },
  {
    dayOfWeek: 6,
    description: 'Обувь, верхняя одежда, сумки, ключи и входная зона.',
    title: 'Прихожая / гардероб',
    tasks: [
      templateTask('Разобрать обувь у входа', 15, 'normal', 'regular', 'low'),
      templateTask('Протереть полку и зеркало', 10, 'normal', 'minimum', 'low'),
      templateTask('Проверить сумки и карманы', 10, 'low', 'minimum', 'low'),
      templateTask('Разобрать сезонную одежду', 60, 'high', 'deep', 'high', {
        frequencyInterval: 6,
        frequencyType: 'monthly',
        isSeasonal: true,
        seasonMonths: [3, 4, 10, 11],
      }),
    ],
  },
  {
    dayOfWeek: 7,
    description: 'Стирка, растения и мягкое закрытие недели.',
    title: 'Стирка / растения',
    tasks: [
      templateTask('Запустить стирку', 5, 'normal', 'minimum', 'low'),
      templateTask(
        'Развесить или разобрать бельё',
        15,
        'normal',
        'regular',
        'low',
      ),
      templateTask('Полить растения', 10, 'normal', 'minimum', 'low'),
      templateTask('Проверить аптечку', 25, 'normal', 'deep', 'normal', {
        frequencyInterval: 3,
        frequencyType: 'monthly',
        isSeasonal: true,
        seasonMonths: [1, 4, 7, 10],
      }),
    ],
  },
]

function templateTask(
  title: string,
  estimatedMinutes: number,
  priority: CleaningPriority,
  depth: CleaningDepth,
  energy: CleaningEnergy,
  overrides: Partial<Omit<NewCleaningTaskInput, 'title' | 'zoneId'>> = {},
): Omit<NewCleaningTaskInput, 'zoneId'> {
  return {
    assignee: overrides.assignee ?? 'anyone',
    customIntervalDays: overrides.customIntervalDays ?? null,
    depth,
    description: overrides.description ?? '',
    energy,
    estimatedMinutes,
    frequencyInterval: overrides.frequencyInterval ?? 1,
    frequencyType: overrides.frequencyType ?? 'weekly',
    impactScore: overrides.impactScore ?? 3,
    isActive: true,
    isSeasonal: overrides.isSeasonal ?? false,
    priority,
    seasonMonths: overrides.seasonMonths ?? [],
    tags: overrides.tags ?? [],
    title,
  }
}

export function filterItemsByFocusMode(
  items: CleaningTaskWithState[],
  mode: FocusMode,
): CleaningTaskWithState[] {
  if (mode === 'all') {
    return items
  }

  if (mode === 'quick') {
    return items.filter(
      (item) =>
        (item.task.estimatedMinutes ?? 999) <= 15 ||
        item.task.energy === 'low' ||
        item.task.depth === 'minimum',
    )
  }

  return items.filter((item) => item.task.depth === mode)
}

export function getHeroHint(today: CleaningTodayResponse): string {
  if (today.summary.urgentCount > 0) {
    return `Одна-две задачи давно ждут внимания, лучше начать с верхнего блока.`
  }

  if (today.summary.quickCount > 0) {
    return 'Можно закрыть короткий набор и оставить глубокие задачи на другой цикл.'
  }

  return 'На сегодня всё выглядит спокойно.'
}

export function getFirstErrorMessage(errors: unknown[]): string | null {
  const error = errors.find(Boolean)

  return error ? getCleaningErrorMessage(error) : null
}

export function getFocusModeAriaLabel(mode: FocusMode): string {
  if (mode === 'all') {
    return 'Показать все задачи'
  }

  if (mode === 'quick') {
    return 'Показать задачи на 15 минут'
  }

  if (mode === 'minimum') {
    return 'Показать минимум'
  }

  if (mode === 'regular') {
    return 'Показать обычную уборку'
  }

  return 'Показать глубокую уборку'
}

export function createActionInput(date: string) {
  return {
    date,
    mode: 'next_cycle' as const,
    note: '',
    targetDate: null,
  }
}

export function getWeekdayLabel(value: number): string {
  return WEEKDAYS.find((day) => day.value === value)?.label ?? 'День'
}

export function getWeekdayShortLabel(value: number): string {
  return WEEKDAYS.find((day) => day.value === value)?.shortLabel ?? 'Д'
}

export function getIsoWeekdayFromDate(date = new Date()): number {
  const day = date.getDay()

  return day === 0 ? 7 : day
}

export function formatFrequency(task: CleaningTaskRecord): string {
  if (task.frequencyType === 'monthly') {
    return `раз в ${task.frequencyInterval} мес.`
  }

  if (task.frequencyType === 'custom') {
    return `раз в ${task.customIntervalDays ?? task.frequencyInterval} дн.`
  }

  return `раз в ${task.frequencyInterval} нед.`
}

export function getHistoryActionLabel(action: string): string {
  if (action === 'completed') {
    return 'выполнено'
  }

  if (action === 'postponed') {
    return 'отложено'
  }

  return 'пропущено'
}

export function formatPostponeCount(count: number): string {
  if (count === 1) {
    return '1 раз'
  }

  if (count >= 2 && count <= 4) {
    return `${count} раза`
  }

  return `${count} раз`
}

export function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function toggleNumber(values: number[], value: number): number[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value].sort((left, right) => left - right)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
