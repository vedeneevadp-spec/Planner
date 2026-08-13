import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TaskRemindersPoller } from './task-reminders.poller.js'
import type { TaskRemindersService } from './task-reminders.service.js'

void test('TaskRemindersPoller becomes unhealthy after repeated infrastructure failures', async () => {
  const failure = new Error('database unavailable')
  let attempts = 0
  let reportUnhealthy!: (error: unknown) => void
  const unhealthy = new Promise<unknown>((resolve) => {
    reportUnhealthy = resolve
  })
  const service = {
    processDueReminders: () => {
      attempts += 1
      return Promise.reject(failure)
    },
  } as unknown as TaskRemindersService
  const poller = new TaskRemindersPoller(
    service,
    {
      error: () => undefined,
      info: () => undefined,
    },
    {
      failureThreshold: 2,
      intervalMs: 1,
      onUnhealthy: reportUnhealthy,
      unrefTimer: false,
    },
  )
  let timeout: NodeJS.Timeout | undefined

  try {
    poller.start()
    const reportedError = await Promise.race([
      unhealthy,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Poller did not become unhealthy.')),
          1_000,
        )
      }),
    ])

    assert.equal(reportedError, failure)
    assert.equal(attempts, 2)
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    await poller.stop()
  }
})
