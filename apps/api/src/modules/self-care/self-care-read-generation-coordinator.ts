interface GenerationBatch<TContext> {
  context: TContext
  from: string
  promise: Promise<void>
  reject: (error: unknown) => void
  resolve: () => void
  started: boolean
  to: string
}

export function createSelfCareReadGenerationKey(input: {
  actorUserId: string
  clientTimeZone?: string | undefined
  workspaceId: string
}): string {
  return JSON.stringify([
    input.workspaceId,
    input.actorUserId,
    input.clientTimeZone ?? 'UTC',
  ])
}

export class SelfCareReadGenerationCoordinator<TContext> {
  private readonly batches = new Map<string, GenerationBatch<TContext>>()

  constructor(private readonly batchWindowMs = 5) {}

  schedule(
    key: string,
    context: TContext,
    from: string,
    to: string,
    generate: (context: TContext, from: string, to: string) => Promise<void>,
  ): Promise<void> {
    const existing = this.batches.get(key)

    if (existing && !existing.started) {
      existing.from = minDate(existing.from, from)
      existing.to = maxDate(existing.to, to)
      return existing.promise
    }

    if (existing && containsRange(existing, from, to)) {
      return existing.promise
    }

    if (existing) {
      return existing.promise
        .catch(() => undefined)
        .then(() => this.schedule(key, context, from, to, generate))
    }

    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const batch: GenerationBatch<TContext> = {
      context,
      from,
      promise,
      reject,
      resolve,
      started: false,
      to,
    }

    this.batches.set(key, batch)
    setTimeout(() => {
      void this.flush(key, batch, generate)
    }, this.batchWindowMs)
    return promise
  }

  private async flush(
    key: string,
    batch: GenerationBatch<TContext>,
    generate: (context: TContext, from: string, to: string) => Promise<void>,
  ): Promise<void> {
    batch.started = true

    try {
      await generate(batch.context, batch.from, batch.to)
      this.batches.delete(key)
      batch.resolve()
    } catch (error: unknown) {
      this.batches.delete(key)
      batch.reject(error)
    }
  }
}

function containsRange(
  range: Pick<GenerationBatch<unknown>, 'from' | 'to'>,
  from: string,
  to: string,
): boolean {
  return range.from <= from && range.to >= to
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right
}

function maxDate(left: string, right: string): string {
  return left >= right ? left : right
}
