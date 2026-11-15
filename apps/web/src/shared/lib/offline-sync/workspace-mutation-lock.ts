const pendingMutations = new Map<string, Promise<unknown>>()
const uncertainPrefix = 'planner.uncertain-offline-mutation:'
const uncertainMutations = new Set<string>()

export class UncertainOfflineMutationError extends Error {
  constructor() {
    super(
      'Не подтверждено завершение синхронизации. Обновите приложение, подключитесь к сети и дождитесь повторной отправки изменений перед восстановлением.',
    )
    this.name = 'UncertainOfflineMutationError'
  }
}

/** A lost response must be reconciled by replaying the same durable command. */
export async function trackOfflineMutation<T>(
  workspaceId: string,
  operationId: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = `${uncertainPrefix}${encodeURIComponent(workspaceId)}:${encodeURIComponent(operationId)}`
  // Persist before dispatch: closing a tab cannot run catch/finally. The same
  // durable command must be replayed before its workspace can be discarded.
  try {
    localStorage.setItem(key, '1')
    if (localStorage.getItem(key) !== '1')
      throw new Error('Fence not persisted')
  } catch {
    throw new UncertainOfflineMutationError()
  }
  uncertainMutations.add(key)
  try {
    const value = await run()
    uncertainMutations.delete(key)
    try {
      localStorage.removeItem(key)
    } catch {
      /* Preserve the fence until storage works again. */
    }
    return value
  } catch (error) {
    if (
      error instanceof Error &&
      'status' in error &&
      typeof error.status === 'number'
    ) {
      // Even a conflict/not-found reply settles this replay; the domain queue
      // reconciles the server result rather than blindly repeating the write.
      uncertainMutations.delete(key)
      try {
        localStorage.removeItem(key)
      } catch {
        /* Keep a persisted fence if storage is unavailable. */
      }
    }
    throw error
  }
}

export function assertOfflineMutationsSettled(workspaceId: string): void {
  const prefix = `${uncertainPrefix}${encodeURIComponent(workspaceId)}:`
  if ([...uncertainMutations].some((key) => key.startsWith(prefix)))
    throw new UncertainOfflineMutationError()
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      if (localStorage.key(index)?.startsWith(prefix))
        throw new UncertainOfflineMutationError()
    }
  } catch {
    throw new UncertainOfflineMutationError()
  }
}

/** Serialize mutations with restore, including across tabs where Web Locks exist. */
export function withWorkspaceMutationLock<T>(
  workspaceId: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = pendingMutations.get(workspaceId)
  const current = (async () => {
    await previous?.catch(() => undefined)
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    return locks
      ? locks.request(`planner-workspace-mutation:${workspaceId}`, run)
      : run()
  })()
  pendingMutations.set(workspaceId, current)
  void current
    .finally(() => {
      if (pendingMutations.get(workspaceId) === current) {
        pendingMutations.delete(workspaceId)
      }
    })
    .catch(() => undefined)
  return current
}

export async function waitForWorkspaceMutations(
  workspaceId: string,
): Promise<void> {
  while (pendingMutations.has(workspaceId)) {
    await pendingMutations.get(workspaceId)?.catch(() => undefined)
  }
}
