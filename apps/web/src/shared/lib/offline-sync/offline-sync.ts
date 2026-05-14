export interface OfflineDrainResultBase {
  failed: number
  processed: number
  synced: number
}

export interface OfflineConflictDetails {
  actualVersion: number | null
  expectedVersion: number | null
}

export type OfflineDrainErrorDecision = 'break' | 'continue'

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
