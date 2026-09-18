// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(
  new URL('../../../../public/sw.js', import.meta.url),
  'utf8',
)

interface WorkerEvent {
  request?: { destination: string; method: string; mode: string; url: string }
  respondWith?: (response: Promise<Response>) => void
  waitUntil: (promise: Promise<unknown>) => void
}

function createWorker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const cachedShell = new Response(
    '<html>Current app shell without built-in input</html>',
  )
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn((request: unknown) =>
      Promise.resolve(request === '/index.html' ? cachedShell : undefined),
    ),
    put: vi.fn().mockResolvedValue(undefined),
  }
  const cacheNames = new Set([
    'chaotika-runtime-v3',
    'chaotika-runtime-v4',
    'other-app-cache',
  ])
  const caches = {
    delete: vi.fn((key: string) => Promise.resolve(cacheNames.delete(key))),
    keys: vi.fn(() => Promise.resolve([...cacheNames])),
    open: vi.fn(() => Promise.resolve(cache)),
  }
  const claim = vi.fn().mockResolvedValue(undefined)
  const indexedDB = { deleteDatabase: vi.fn() }
  const fetch = vi.fn().mockRejectedValue(new Error('Offline'))
  runInNewContext(source, {
    caches,
    clearTimeout,
    fetch,
    indexedDB,
    Response,
    self: {
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) =>
        listeners.set(name, handler),
      clients: { claim },
      location: { origin: 'https://planner.test' },
      skipWaiting: vi.fn(),
    },
    setTimeout,
    URL,
  })

  return { cache, cachedShell, cacheNames, caches, claim, indexedDB, listeners }
}

describe('service worker retirement update', () => {
  it('installs the current shell and retires old runtime caches without deleting user databases', async () => {
    const worker = createWorker()
    const pending: Promise<unknown>[] = []
    const event = {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    }

    worker.listeners.get('install')?.(event)
    await Promise.all(pending)
    expect(worker.caches.open).toHaveBeenCalledWith('chaotika-runtime-v4')
    expect(worker.cache.addAll).toHaveBeenCalledWith(
      expect.arrayContaining(['/index.html', '/today']),
    )

    worker.listeners.get('activate')?.(event)
    await Promise.all(pending)

    expect(worker.cacheNames).toEqual(
      new Set(['chaotika-runtime-v4', 'other-app-cache']),
    )
    expect(worker.caches.delete).toHaveBeenCalledWith('chaotika-runtime-v3')
    expect(worker.indexedDB.deleteDatabase).not.toHaveBeenCalled()
    expect(worker.claim).toHaveBeenCalledOnce()
  })

  it('serves the current cached shell offline for the retired settings URL', async () => {
    const worker = createWorker()
    const responses: Promise<Response>[] = []
    const pending: Promise<unknown>[] = []

    worker.listeners.get('fetch')?.({
      request: {
        destination: 'document',
        method: 'GET',
        mode: 'navigate',
        url: 'https://planner.test/voice-assistant/settings',
      },
      respondWith: (response) => responses.push(response),
      waitUntil: (promise) => pending.push(promise),
    })
    await Promise.all(pending)

    expect(responses).toHaveLength(1)
    expect(await responses[0]).toBe(worker.cachedShell)
    expect(worker.caches.open).toHaveBeenCalledWith('chaotika-runtime-v4')
  })
})
