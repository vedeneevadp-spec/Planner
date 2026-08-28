import type { SharedTaskNotificationsService } from './shared-task-notifications.service.js'

interface PollerLogger {
  error: (payload: unknown, message: string) => void
  info: (payload: unknown, message: string) => void
}

const DEFAULT_BATCH_SIZE = 50
const DEFAULT_FAILURE_THRESHOLD = 5
const DEFAULT_INTERVAL_MS = 5_000

export class SharedTaskNotificationsPoller {
  private activeRun: Promise<void> | null = null
  private consecutiveFailures = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly service: SharedTaskNotificationsService,
    private readonly logger: PollerLogger,
    private readonly options: {
      batchSize?: number | undefined
      failureThreshold?: number | undefined
      intervalMs?: number | undefined
      onUnhealthy?: ((error: unknown) => void) | undefined
      unrefTimer?: boolean | undefined
    } = {},
  ) {}

  start(): void {
    if (this.timer) {
      return
    }

    void this.runOnce()

    this.timer = setInterval(() => {
      void this.runOnce()
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS)

    if (this.options.unrefTimer !== false) {
      this.timer.unref?.()
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    if (this.activeRun) {
      await this.activeRun
    }
  }

  private runOnce(): Promise<void> {
    if (this.activeRun) {
      return this.activeRun
    }

    this.activeRun = (async () => {
      try {
        const result = await this.service.processPendingNotifications(
          this.options.batchSize ?? DEFAULT_BATCH_SIZE,
        )

        if (result.claimedCount > 0) {
          this.logger.info(result, 'Processed shared task notifications.')
        }
        this.consecutiveFailures = 0
      } catch (error) {
        this.consecutiveFailures += 1
        this.logger.error(
          { err: error },
          'Shared task notifications poller failed.',
        )

        if (
          this.consecutiveFailures >=
          (this.options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD)
        ) {
          if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
          }
          const onUnhealthy =
            this.options.onUnhealthy ?? defaultUnhealthyHandler
          onUnhealthy(error)
        }
      } finally {
        this.activeRun = null
      }
    })()

    return this.activeRun
  }
}

function defaultUnhealthyHandler(error: unknown): void {
  queueMicrotask(() => {
    throw error instanceof Error
      ? error
      : new Error('Shared task notifications poller became unhealthy.')
  })
}
