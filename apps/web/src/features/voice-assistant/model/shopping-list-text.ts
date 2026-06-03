export function formatShoppingListText(value: string): string {
  return value
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('ru-RU'))
}

function normalizeShoppingListTextForMatch(value: string): string {
  return formatShoppingListText(value)
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
}

export function findShoppingListItemByText<T extends { text: string }>(
  items: readonly T[],
  text: string,
): T | undefined {
  const normalizedText = normalizeShoppingListTextForMatch(text)

  return items.find(
    (item) => normalizeShoppingListTextForMatch(item.text) === normalizedText,
  )
}

export function isActiveShoppingListTextItem(item: {
  status: string
}): boolean {
  return item.status !== 'archived'
}
