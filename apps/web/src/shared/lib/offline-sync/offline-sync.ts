export interface OfflineDrainResultBase {
  failed: number
  processed: number
  synced: number
}

export interface OfflineConflictDetails {
  actualVersion: number | null
  expectedVersion: number | null
}

export interface OfflineDrainConflictInput extends OfflineConflictDetails {
  message: string
}

export type OfflineDrainErrorDecision = 'break' | 'continue'

export interface OfflineQueueAdapter<TMutation> {
  completeMutation: (mutationId: string) => Promise<void>
  getMutationId: (mutation: TMutation) => string
  listRetryableMutations: () => Promise<TMutation[]>
  markMutationSyncing: (mutationId: string) => Promise<void>
}

interface DrainOfflineMutationsOptions<
  TMutation,
  TResult extends OfflineDrainResultBase,
> {
  apply: (mutation: TMutation) => Promise<void>
  complete: (mutationId: string) => Promise<void>
  getMutationId: (mutation: TMutation) => string
  markSyncing: (mutationId: string) => Promise<void>
  mutations: TMutation[]
  result: TResult
  onError: (input: {
    error: unknown
    mutation: TMutation
    mutationId: string
    result: TResult
  }) => Promise<OfflineDrainErrorDecision>
}

interface DrainOfflineQueueOptions<
  TMutation,
  TResult extends OfflineDrainResultBase,
> {
  adapter: OfflineQueueAdapter<TMutation>
  apply: (mutation: TMutation) => Promise<void>
  result: TResult
  onError: (input: {
    error: unknown
    mutation: TMutation
    mutationId: string
    result: TResult
  }) => Promise<OfflineDrainErrorDecision>
}

interface OfflineDrainConflictResult extends OfflineDrainResultBase {
  conflicted: number
}

interface OfflineDrainErrorHandlerOptions {
  getErrorMessage: (error: unknown) => string
  isTerminalError: (error: unknown) => boolean
  markConflicted: (
    mutationId: string,
    conflict: OfflineDrainConflictInput,
  ) => Promise<void>
  markFailed: (mutationId: string, message: string) => Promise<void>
  readConflict?: ((error: unknown) => OfflineConflictDetails) | undefined
}

type OfflineDrainResultExtra<TResult extends OfflineDrainResultBase> = Omit<
  TResult,
  keyof OfflineDrainResultBase
>

export function createOfflineDrainResult(): OfflineDrainResultBase
export function createOfflineDrainResult<
  TResult extends OfflineDrainResultBase,
>(extraResult: OfflineDrainResultExtra<TResult>): TResult
export function createOfflineDrainResult<
  TResult extends OfflineDrainResultBase,
>(extraResult?: OfflineDrainResultExtra<TResult>): TResult {
  return {
    failed: 0,
    processed: 0,
    synced: 0,
    ...extraResult,
  } as TResult
}

export async function drainOfflineQueue<
  TMutation,
  TResult extends OfflineDrainResultBase,
>({
  adapter,
  apply,
  result,
  onError,
}: DrainOfflineQueueOptions<TMutation, TResult>): Promise<TResult> {
  const mutations = await adapter.listRetryableMutations()

  return drainOfflineMutations({
    apply,
    complete: adapter.completeMutation,
    getMutationId: adapter.getMutationId,
    markSyncing: adapter.markMutationSyncing,
    mutations,
    result,
    onError,
  })
}

export async function drainOfflineMutations<
  TMutation,
  TResult extends OfflineDrainResultBase,
>({
  apply,
  complete,
  getMutationId,
  markSyncing,
  mutations,
  result,
  onError,
}: DrainOfflineMutationsOptions<TMutation, TResult>): Promise<TResult> {
  for (const mutation of mutations) {
    const mutationId = getMutationId(mutation)

    result.processed += 1
    await markSyncing(mutationId)

    try {
      await apply(mutation)
      await complete(mutationId)
      result.synced += 1
    } catch (error) {
      const decision = await onError({
        error,
        mutation,
        mutationId,
        result,
      })

      if (decision === 'break') {
        break
      }
    }
  }

  return result
}

export function createOfflineDrainErrorHandler<
  TResult extends OfflineDrainConflictResult,
>({
  getErrorMessage,
  isTerminalError,
  markConflicted,
  markFailed,
  readConflict,
}: OfflineDrainErrorHandlerOptions) {
  return async ({
    error,
    mutationId,
    result,
  }: {
    error: unknown
    mutationId: string
    result: TResult
  }): Promise<OfflineDrainErrorDecision> => {
    const message = getErrorMessage(error)

    if (isTerminalError(error)) {
      const conflict = readConflict?.(error) ?? {
        actualVersion: null,
        expectedVersion: null,
      }

      await markConflicted(mutationId, {
        actualVersion: conflict.actualVersion,
        expectedVersion: conflict.expectedVersion,
        message,
      })
      result.conflicted += 1

      return 'continue'
    }

    await markFailed(mutationId, message)
    result.failed += 1

    return 'break'
  }
}

export function createOfflineDrainCoordinator<TKey, TResult>() {
  let currentDrain: {
    key: TKey
    promise: Promise<TResult>
  } | null = null

  return {
    async drain(key: TKey, run: () => Promise<TResult>): Promise<TResult> {
      if (currentDrain) {
        if (Object.is(currentDrain.key, key)) {
          return currentDrain.promise
        }

        await currentDrain.promise.catch(() => undefined)
      }

      const drainPromise = run().finally(() => {
        if (currentDrain?.promise === drainPromise) {
          currentDrain = null
        }
      })

      currentDrain = {
        key,
        promise: drainPromise,
      }

      return drainPromise
    },
  }
}

export function isBrowserRetryableOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }

  return error instanceof DOMException || error instanceof TypeError
}

export function getOfflineErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof Error) {
    return error.message
  }

  return fallbackMessage
}

export function readOfflineConflictDetails(
  details: unknown,
): OfflineConflictDetails {
  if (!isRecord(details)) {
    return {
      actualVersion: null,
      expectedVersion: null,
    }
  }

  return {
    actualVersion: getNumber(details.actualVersion),
    expectedVersion: getNumber(details.expectedVersion),
  }
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
