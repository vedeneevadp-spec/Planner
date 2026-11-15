import { afterEach, expect, it, vi } from 'vitest'

import { RequestTimeoutError } from '@/shared/lib/api-client'

import { downloadUserBackup } from './user-backup-api'

afterEach(() => vi.useRealTimers())

it('bounds export download through the final body chunk without retrying', async () => {
  vi.useFakeTimers()
  let release!: (value: string) => void
  const body = new Promise<string>((resolve) => {
    release = resolve
  })
  const fetchFn = vi.fn<typeof fetch>().mockResolvedValue({
    status: 200,
    ok: true,
    headers: new Headers(),
    text: () => body,
  } as Response)
  const result = downloadUserBackup(
    { accessToken: 'token', actorUserId: 'actor', workspaceId: 'workspace' },
    fetchFn,
  )
  const rejected = expect(result).rejects.toBeInstanceOf(RequestTimeoutError)
  await vi.advanceTimersByTimeAsync(120_000)
  await rejected
  expect(fetchFn).toHaveBeenCalledTimes(1)
  expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  release('{}')
})
