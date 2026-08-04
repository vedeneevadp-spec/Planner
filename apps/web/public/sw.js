const CACHE_NAME = 'chaotika-runtime-v3'
const CACHE_PREFIX = 'chaotika-'
const NAVIGATION_NETWORK_TIMEOUT_MS = 2_000
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/today',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return
  }

  if (request.mode === 'navigate') {
    const { networkResponsePromise, responsePromise } =
      createNavigationRequestPromises(request)

    event.respondWith(responsePromise)
    event.waitUntil(networkResponsePromise.then(() => undefined))
    return
  }

  if (
    url.pathname.startsWith('/assets/') ||
    ['font', 'image', 'manifest', 'script', 'style'].includes(
      request.destination,
    )
  ) {
    event.respondWith(handleStaticAssetRequest(request))
  }
})

function createNavigationRequestPromises(request) {
  const cacheStatePromise = caches.open(CACHE_NAME).then(async (cache) => ({
    cache,
    cachedResponse:
      (await cache.match(request)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/today')),
  }))
  const networkResponsePromise = cacheStatePromise.then(
    ({ cache, cachedResponse }) =>
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            await cache.put(request, response.clone())
          }

          return response
        })
        .catch(
          () =>
            cachedResponse ||
            new Response('Chaotika недоступна без подключения к сети.', {
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              status: 503,
            }),
        ),
  )
  const responsePromise = cacheStatePromise.then(({ cachedResponse }) => {
    if (!cachedResponse) {
      return networkResponsePromise
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(cachedResponse)
      }, NAVIGATION_NETWORK_TIMEOUT_MS)

      void networkResponsePromise.then((response) => {
        clearTimeout(timeoutId)
        resolve(response)
      })
    })
  })

  return {
    networkResponsePromise,
    responsePromise,
  }
}

async function handleStaticAssetRequest(request) {
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(request)

  const networkResponsePromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone())
      }

      return response
    })
    .catch(() => cachedResponse)

  return cachedResponse || networkResponsePromise
}
