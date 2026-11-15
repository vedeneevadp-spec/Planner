import { afterEach, expect, it, vi } from 'vitest'

import { createApiRequester } from './api-client'
import { REQUEST_TIMEOUT_MS, RequestTimeoutError } from './request-timeout'

afterEach(() => {
  vi.useRealTimers()
})

it('bounds a stalled request body and does not retry a mutation', async () => {
  vi.useFakeTimers()
  let release!: (value: string) => void
  const text = new Promise<string>((resolve) => {
    release = resolve
  })
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue({ status: 200, ok: true, text: () => text } as Response)
  const { request } = createApiRequester(
    { apiBaseUrl: 'https://example.test', workspaceId: 'body-deadline' },
    (message) => new Error(message),
    fetchFn,
  )
  const result = request({
    path: '/api/v1/tasks',
    method: 'POST',
    body: { title: 'One write' },
    writeAccess: true,
  })
  const rejected = expect(result).rejects.toBeInstanceOf(RequestTimeoutError)
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
  await rejected
  expect(fetchFn).toHaveBeenCalledTimes(1)
  expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  release('{}')
  await Promise.resolve()
})

it('serializes restore behind a previously sent workspace mutation', async () => {
  let release!: (value: Response) => void
  const pending = new Promise<Response>((resolve) => {
    release = resolve
  })
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(() => pending)
    .mockResolvedValue(new Response('{}'))
  const { request } = createApiRequester(
    { apiBaseUrl: 'https://example.test', workspaceId: 'restore-order' },
    (message) => new Error(message),
    fetchFn,
  )
  const write = request({
    path: '/api/v1/tasks/t1',
    method: 'DELETE',
    writeAccess: true,
  })
  await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
  const restore = request({
    path: '/api/v1/backups/import/restore',
    method: 'POST',
    writeAccess: true,
  })
  await Promise.resolve()
  expect(fetchFn).toHaveBeenCalledTimes(1)
  release(new Response(null, { status: 204 }))
  await Promise.all([write, restore])
  expect(fetchFn).toHaveBeenCalledTimes(2)
})
