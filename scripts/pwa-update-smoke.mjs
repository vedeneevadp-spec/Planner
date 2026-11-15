import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { build } from 'vite'

// Exercise the real production bundle and worker, without a live account/API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(path.join(os.tmpdir(), 'planner-pwa-smoke-'))
let browser
let server
let workerVersion = 1
try {
  process.env.VITE_AUTH_PROVIDER = 'planner'
  process.env.VITE_API_BASE_URL = 'http://127.0.0.1:9'
  await build({
    configFile: path.join(root, 'apps/web/vite.config.ts'),
    build: { outDir: directory, emptyOutDir: true },
    logLevel: 'warn',
  })
  const contentTypes = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
  }
  server = http.createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url, 'http://localhost').pathname
      const target = path.resolve(directory, `.${decodeURIComponent(pathname)}`)
      if (
        target !== directory &&
        !target.startsWith(`${directory}${path.sep}`)
      ) {
        response.writeHead(400).end()
        return
      }
      let file = target
      let body
      try {
        body = await readFile(file)
      } catch {
        file = path.join(directory, 'index.html')
        body = await readFile(file)
      }
      if (pathname === '/sw.js') {
        body = Buffer.concat([
          body,
          Buffer.from(`\n// smoke version ${workerVersion}\n`),
        ])
      }
      response
        .writeHead(200, {
          'content-type':
            contentTypes[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        })
        .end(body)
    })().catch(() => response.writeHead(500).end())
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(30_000)
  await page.goto(`${origin}/today`)
  const email = page.getByLabel('Email', { exact: true })
  await email.fill('unsaved-pwa-draft@example.test')
  await page.evaluate(() => {
    globalThis.__pwaDraftDocument = 'original-document'
  })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))

  workerVersion = 2
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration.update()
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 15_000
      const check = () => {
        if (registration.waiting) {
          globalThis.__pwaWaitingWorker = registration.waiting
          resolve()
        } else if (Date.now() > deadline) {
          reject(new Error('Updated worker did not enter the waiting state.'))
        } else {
          setTimeout(check, 20)
        }
      }
      check()
    })
  })
  assert.equal(await email.inputValue(), 'unsaved-pwa-draft@example.test')
  assert.equal(
    await page.evaluate(() => globalThis.__pwaDraftDocument),
    'original-document',
  )

  // Also protect against controller changes from an already-installed worker.
  await page.evaluate(async () => {
    const changed = new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('Controller did not change.')),
        15_000,
      )
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          clearTimeout(deadline)
          resolve()
        },
        { once: true },
      )
    })
    globalThis.__pwaWaitingWorker.postMessage({ type: 'SKIP_WAITING' })
    await changed
  })
  assert.equal(await email.inputValue(), 'unsaved-pwa-draft@example.test')
  assert.equal(
    await page.evaluate(() => globalThis.__pwaDraftDocument),
    'original-document',
  )
  await mkdir(path.join(root, 'tmp'), { recursive: true })
  await page.screenshot({
    path: path.join(root, 'tmp/pwa-update-smoke.png'),
    fullPage: true,
  })
  console.log(
    'Production PWA update passed: worker waits; controller change preserves the document and unsaved form input.',
  )
} finally {
  await browser?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
