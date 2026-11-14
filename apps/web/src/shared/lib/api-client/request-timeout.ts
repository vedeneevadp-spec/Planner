export const REQUEST_TIMEOUT_MS = 15_000

export class RequestTimeoutError extends TypeError {
  constructor() {
    super('Network request timeout')
    this.name = 'RequestTimeoutError'
  }
}

/** Keep the deadline active until the response body has also been consumed. */
export async function withRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: {
    signal?: AbortSignal | undefined
    timeoutMs?: number | undefined
  } = {},
): Promise<T> {
  const callerSignal = options.signal

  if (callerSignal?.aborted) {
    throw getAbortReason(callerSignal)
  }

  const controller = new AbortController()
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  let cancelFromCaller: (() => void) | undefined
  const deadline = new Promise<never>((_, reject) => {
    const cancel = (reason: unknown) => {
      // Reject explicitly as a stalled transport may ignore AbortSignal.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- AbortSignal permits arbitrary caller reasons; preserve native fetch semantics.
      reject(reason)
      controller.abort(reason)
    }

    if (callerSignal) {
      cancelFromCaller = () => cancel(getAbortReason(callerSignal))
      callerSignal.addEventListener('abort', cancelFromCaller, { once: true })
    }
    timeoutId = globalThis.setTimeout(
      () => cancel(new RequestTimeoutError()),
      options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    )
  })

  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) {
          throw getAbortReason(controller.signal)
        }

        return operation(controller.signal)
      }),
      deadline,
    ])
  } finally {
    globalThis.clearTimeout(timeoutId)

    if (cancelFromCaller) {
      callerSignal?.removeEventListener('abort', cancelFromCaller)
    }
  }
}

function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException('The operation was aborted.', 'AbortError')
    : signal.reason
}
