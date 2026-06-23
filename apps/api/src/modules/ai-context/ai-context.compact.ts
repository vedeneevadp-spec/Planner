import { getTodayDate } from '@planner/contracts'

export interface CompactForAiOptions {
  maxArrayItems?: number
  maxStringLength?: number
  mode?: 'default' | 'search'
  todayDate?: string | undefined
}

const DEFAULT_MAX_ARRAY_ITEMS = 50
const SEARCH_MAX_ARRAY_ITEMS = 30
const DEFAULT_MAX_STRING_LENGTH = 500

const TECHNICAL_KEYS = new Set([
  'accessToken',
  'auth',
  'authorization',
  'clientSecret',
  'codeHash',
  'createdAt',
  'createdBy',
  'deletedAt',
  'deviceId',
  'email',
  'expiresAt',
  'id',
  'internalId',
  'ipAddress',
  'jti',
  'metadata',
  'password',
  'passwordHash',
  'refreshToken',
  'refreshTokenHash',
  'resetToken',
  'secret',
  'session',
  'sessionId',
  'token',
  'tokenHash',
  'updatedAt',
  'updatedBy',
  'userId',
  'version',
  'workspaceId',
])

export function compactForAi<T>(input: T, options: CompactForAiOptions = {}) {
  const maxArrayItems =
    options.maxArrayItems ??
    (options.mode === 'search'
      ? SEARCH_MAX_ARRAY_ITEMS
      : DEFAULT_MAX_ARRAY_ITEMS)
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
  const todayDate = options.todayDate ?? getTodayDate('UTC')

  return compactValue(input, {
    maxArrayItems,
    maxStringLength,
    todayDate,
  }) as T
}

export function compactArrayForAi<T>(
  input: readonly T[],
  options: CompactForAiOptions = {},
): {
  items: T[]
  returnedCount: number
  totalCount: number
} {
  const maxArrayItems =
    options.maxArrayItems ??
    (options.mode === 'search'
      ? SEARCH_MAX_ARRAY_ITEMS
      : DEFAULT_MAX_ARRAY_ITEMS)
  const todayDate = options.todayDate ?? getTodayDate('UTC')
  const items = compactForAi(sortImportantFirst([...input], todayDate), {
    ...options,
    maxArrayItems,
    todayDate,
  }).slice(0, maxArrayItems)

  return {
    items,
    returnedCount: items.length,
    totalCount: input.length,
  }
}

function compactValue(
  input: unknown,
  options: Required<
    Pick<CompactForAiOptions, 'maxArrayItems' | 'maxStringLength' | 'todayDate'>
  >,
): unknown {
  if (Array.isArray(input)) {
    return sortImportantFirst(input, options.todayDate)
      .slice(0, options.maxArrayItems)
      .map((item) => compactValue(item, options))
  }

  if (typeof input === 'string') {
    return input.length > options.maxStringLength
      ? input.slice(0, options.maxStringLength)
      : input
  }

  if (!isRecord(input)) {
    return input
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (shouldDropKey(key, input)) {
      continue
    }

    result[key] = compactValue(value, options)
  }

  return result
}

export function sortImportantFirst<T>(
  items: readonly T[],
  todayDate: string = getTodayDate('UTC'),
): T[] {
  return [...items].sort(
    (left, right) => scoreItem(right, todayDate) - scoreItem(left, todayDate),
  )
}

function scoreItem(item: unknown, todayDate: string): number {
  if (!isRecord(item)) {
    return 0
  }

  let score = 0
  const status = readString(item.status)
  const priority = readString(item.priority)
  const urgency = readString(item.urgency)
  const importance = readString(item.importance)
  const dueDate = readString(item.dueDate) ?? readString(item.date)

  if (status === 'overdue' || status === 'missed') {
    score += 100
  }

  if (
    status === 'todo' ||
    status === 'planned' ||
    status === 'scheduled' ||
    status === 'in_progress'
  ) {
    score += 10
  }

  if (
    priority === 'high' ||
    urgency === 'urgent' ||
    importance === 'important' ||
    item.urgent === true
  ) {
    score += 30
  }

  if (dueDate && dueDate < todayDate) {
    score += 40
  }

  return score
}

function shouldDropKey(key: string, parent?: unknown): boolean {
  if (key === 'source') {
    return false
  }

  if (key === 'id' && isFlexibleGoalContext(parent)) {
    return false
  }

  if (TECHNICAL_KEYS.has(key)) {
    return true
  }

  const normalizedKey = key.toLowerCase()

  return (
    normalizedKey.includes('token') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('session') ||
    normalizedKey.includes('auth')
  )
}

function isFlexibleGoalContext(
  value: unknown,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.type === 'flexible_goal' &&
    value.expectedRepeats === true
  )
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
