export type CleaningFocusMode = 'all' | 'low' | 'normal' | 'high'

export const CLEANING_FOCUS_QUERY_KEY = 'cleaningMode'
export const CLEANING_FOCUS_MODES = [
  'all',
  'low',
  'normal',
  'high',
] as const satisfies readonly CleaningFocusMode[]

export function getCleaningFocusModeFromSearchParams(
  searchParams: URLSearchParams,
): CleaningFocusMode {
  const mode = searchParams.get(CLEANING_FOCUS_QUERY_KEY)

  return isCleaningFocusMode(mode) ? mode : 'all'
}

export function getCleaningFocusModeAriaLabel(mode: CleaningFocusMode): string {
  if (mode === 'all') {
    return 'Показать все задачи'
  }

  if (mode === 'low') {
    return 'Показать низкий приоритет'
  }

  if (mode === 'normal') {
    return 'Показать обычный приоритет'
  }

  return 'Показать важные задачи'
}

function isCleaningFocusMode(value: string | null): value is CleaningFocusMode {
  return (
    value !== null &&
    (CLEANING_FOCUS_MODES as readonly string[]).includes(value)
  )
}
