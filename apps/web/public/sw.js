const CACHE_NAME = 'chaotika-runtime-v1'
const CACHE_PREFIX = 'chaotika-'
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
    event.respondWith(handleNavigationRequest(request))
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

async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME)

  try {
    const response = await fetch(request)

    if (response.ok) {
      await cache.put(request, response.clone())
    }

    return response
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/today'))
    )
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
