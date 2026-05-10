import type { TaskRemindersService } from './task-reminders.service.js'

interface PollerLogger {
  error: (payload: unknown, message: string) => void
  info: (payload: unknown, message: string) => void
}

const DEFAULT_BATCH_SIZE = 25
const DEFAULT_INTERVAL_MS = 60_000

export class TaskRemindersPoller {
  private activeRun: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly service: TaskRemindersService,
    private readonly logger: PollerLogger,
    private readonly options: {
      batchSize?: number | undefined
      intervalMs?: number | undefined
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
        const result = await this.service.processDueReminders(
          this.options.batchSize ?? DEFAULT_BATCH_SIZE,
        )

        if (result.claimedCount > 0) {
          this.logger.info(result, 'Processed due task reminders.')
        }
      } catch (error) {
        this.logger.error({ err: error }, 'Task reminder poller failed.')
      } finally {
        this.activeRun = null
      }
    })()

    return this.activeRun
  }
}
