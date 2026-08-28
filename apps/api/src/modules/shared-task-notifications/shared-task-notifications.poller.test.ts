import assert from 'node:assert/strict'
import test from 'node:test'

import { SharedTaskNotificationsPoller } from './shared-task-notifications.poller.js'
import type { SharedTaskNotificationsService } from './shared-task-notifications.service.js'

void test('SharedTaskNotificationsPoller becomes unhealthy after repeated infrastructure failures', async () => {
  const failure = new Error('database unavailable')
  let attempts = 0
  let reportUnhealthy!: (error: unknown) => void
  const unhealthy = new Promise<unknown>((resolve) => {
    reportUnhealthy = resolve
  })
  const service = {
    processPendingNotifications: () => {
      attempts += 1
      return Promise.reject(failure)
    },
  } as unknown as SharedTaskNotificationsService
  const poller = new SharedTaskNotificationsPoller(
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
