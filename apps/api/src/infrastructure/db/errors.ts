export function isTransientDatabaseError(error: unknown): boolean {
  const code = getDatabaseErrorCode(error)
  const message = error instanceof Error ? error.message : ''

  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === '57014' ||
    message.includes('Query read timeout') ||
    message.includes('read ETIMEDOUT')
  )
}

export function getDatabaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const { code } = error

  return typeof code === 'string' ? code : undefined
}
