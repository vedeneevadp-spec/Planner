export const MAX_CHAOS_TEXT_LENGTH = 5000

export interface ChaosDumpParseResult {
  error: string | null
  items: string[]
}

export function normalizeChaosText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+$/gm, '')
    .trim()
    .replace(/\n{3,}/g, '\n\n')
}

export function parseChaosDump(
  value: string,
  options: { splitByLines: boolean },
): ChaosDumpParseResult {
  const normalizedText = normalizeChaosText(value)

  if (!normalizedText) {
    return {
      error: 'Напишите хотя бы одну мысль.',
      items: [],
    }
  }

  if (normalizedText.length > MAX_CHAOS_TEXT_LENGTH) {
    return {
      error: `Максимум ${MAX_CHAOS_TEXT_LENGTH} символов за один сброс.`,
      items: [],
    }
  }

  const items = options.splitByLines
    ? normalizedText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [normalizedText]

  if (items.length === 0) {
    return {
      error: 'После очистки пустых строк ничего не осталось.',
      items: [],
    }
  }

  return {
    error: null,
    items,
  }
}
