const prefix = 'planner.workspaceWriteEpoch:'
const volatileEpochs = new Map<string, string>()
const scopesPrefix = 'planner.workspaceWriteScopes:'
const volatileScopes = new Map<string, string[]>()
const listeners = new Set<() => void>()

export function readWorkspaceWriteEpoch(workspaceId: string): string {
  try {
    const value = localStorage.getItem(`${prefix}${workspaceId}`)
    const stored = value && /^(0|[1-9][0-9]{0,18})$/.test(value) ? value : '0'
    const memory = volatileEpochs.get(workspaceId) ?? '0'
    return BigInt(memory) > BigInt(stored) ? memory : stored
  } catch {
    return volatileEpochs.get(workspaceId) ?? '0'
  }
}

export function rememberWorkspaceWriteEpoch(response: Response): void {
  const workspaceId = response.headers.get('x-workspace-id')
  const epoch = response.headers.get('x-workspace-epoch')
  if (!workspaceId || !epoch || !/^(0|[1-9][0-9]{0,18})$/.test(epoch)) return
  rememberEpoch(workspaceId, epoch)
  const actorId = response.headers.get('x-workspace-actor-id')
  const scopeHeader = response.headers.get('x-workspace-epochs')
  if (actorId && scopeHeader) {
    try {
      const scopes: unknown = JSON.parse(scopeHeader)
      if (scopes && typeof scopes === 'object' && !Array.isArray(scopes)) {
        const entries = Object.entries(scopes)
        if (
          entries.length <= 4 &&
          entries.every(
            ([id, value]) =>
              /^[a-zA-Z0-9_-]{1,128}$/.test(id) &&
              typeof value === 'string' &&
              /^(0|[1-9][0-9]{0,18})$/.test(value),
          )
        ) {
          for (const [id, value] of entries) rememberEpoch(id, value as string)
          const key = `${scopesPrefix}${actorId}:${workspaceId}`
          const ids = entries.map(([id]) => id)
          try {
            localStorage.setItem(key, JSON.stringify(ids))
          } catch {
            volatileScopes.set(key, ids)
          }
        }
      }
    } catch {
      /* An old server may not provide scoped metadata. */
    }
  }
  for (const listener of listeners) listener()
}

function rememberEpoch(workspaceId: string, epoch: string): void {
  // Ignore an older read response arriving after a newer session snapshot.
  if (BigInt(epoch) < BigInt(readWorkspaceWriteEpoch(workspaceId))) return
  try {
    localStorage.setItem(`${prefix}${workspaceId}`, epoch)
  } catch {
    volatileEpochs.set(workspaceId, epoch)
  }
}

export function readWorkspaceWriteEpochs(
  workspaceId: string,
  actorId?: string,
): Record<string, string> {
  const ids = new Set([workspaceId])
  if (actorId) {
    const key = `${scopesPrefix}${actorId}:${workspaceId}`
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
      if (Array.isArray(stored) && stored.length <= 4)
        for (const id of stored) {
          if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id))
            ids.add(id)
        }
    } catch {
      /* Use the in-memory copy when storage is unavailable. */
    }
    for (const id of volatileScopes.get(key) ?? []) ids.add(id)
  }
  return Object.fromEntries(
    [...ids].sort().map((id) => [id, readWorkspaceWriteEpoch(id)]),
  )
}

export function assertOfflineWorkspaceEpoch(
  mutation: { workspaceId: string; writeEpoch?: string },
  clientEpoch: string | undefined,
  createError: (
    message: string,
    options: { status: number; code: string },
  ) => Error,
): void {
  const epoch = mutation.writeEpoch ?? '0'
  if (
    epoch !== readWorkspaceWriteEpoch(mutation.workspaceId) ||
    epoch !== (clientEpoch ?? '0')
  ) {
    throw createError(
      'Данные восстановлены. Старое изменение не отправлено; создайте его заново после проверки данных.',
      { status: 409, code: 'workspace_restored' },
    )
  }
}

export function subscribeWorkspaceEpochs(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(prefix) || event.key?.startsWith(scopesPrefix))
      listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
