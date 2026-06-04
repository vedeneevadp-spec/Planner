export function formatTaskCount(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) {
    return `${count} задача`
  }

  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) {
    return `${count} задачи`
  }

  return `${count} задач`
}

export function plural(
  value: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = value % 10
  const mod100 = value % 100

  if (mod10 === 1 && mod100 !== 11) {
    return one
  }

  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
    return few
  }

  return many
}
