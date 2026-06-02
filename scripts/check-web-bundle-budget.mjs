import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const distDirectory = path.join(repoRoot, 'apps', 'web', 'dist')
const indexHtmlPath = path.join(distDirectory, 'index.html')

const initialJsMaxBytes = readBudgetKilobytes(
  'WEB_BUNDLE_INITIAL_JS_MAX_KB',
  900,
)
const entryJsMaxBytes = readBudgetKilobytes('WEB_BUNDLE_ENTRY_JS_MAX_KB', 260)
const forbiddenInitialPreloadPatterns = [
  /\/assets\/NativePlannerWidgetSync-[^/]+\.js$/,
  /\/assets\/VoiceAssistant-[^/]+\.js$/,
  /\/assets\/VoiceAssistantSettingsPanel-[^/]+\.js$/,
  /\/assets\/lottie_light_canvas-[^/]+\.js$/,
  /\/assets\/native-voice-assistant-[^/]+\.js$/,
]

const indexHtml = await readText(indexHtmlPath)
const entryScript = readEntryScript(indexHtml)
const modulePreloads = readModulePreloads(indexHtml)
const initialJsFiles = [entryScript, ...modulePreloads]
const forbiddenPreloads = modulePreloads.filter((href) =>
  forbiddenInitialPreloadPatterns.some((pattern) => pattern.test(href)),
)
const entrySize = await readDistFileSize(entryScript)
const initialJsSize = await sumDistFileSizes(initialJsFiles)

assert.deepEqual(
  forbiddenPreloads,
  [],
  [
    'Deferred chunks must not be preloaded by index.html.',
    'Keep voice assistant, native bridge, widget sync, and lottie behind lazy imports.',
    forbiddenPreloads.join('\n'),
  ].join('\n'),
)

assert.ok(
  entrySize <= entryJsMaxBytes,
  `Entry JS is ${(entrySize / 1024).toFixed(1)} KB; budget is ${(entryJsMaxBytes / 1024).toFixed(1)} KB.`,
)
assert.ok(
  initialJsSize <= initialJsMaxBytes,
  `Initial JS is ${(initialJsSize / 1024).toFixed(1)} KB; budget is ${(initialJsMaxBytes / 1024).toFixed(1)} KB.`,
)

console.log(
  [
    'Web bundle budget check passed.',
    `Entry JS: ${(entrySize / 1024).toFixed(1)} KB.`,
    `Initial JS: ${(initialJsSize / 1024).toFixed(1)} KB.`,
  ].join(' '),
)

async function readText(filePath) {
  return await import('node:fs/promises').then(({ readFile }) =>
    readFile(filePath, 'utf8'),
  )
}

function readEntryScript(indexHtmlContent) {
  const match = indexHtmlContent.match(
    /<script\s+type="module"\s+crossorigin\s+src="([^"]+\.js)"><\/script>/,
  )

  assert.ok(match?.[1], 'Could not find entry module script in index.html.')

  return match[1]
}

function readModulePreloads(indexHtmlContent) {
  return [
    ...indexHtmlContent.matchAll(
      /<link\s+rel="modulepreload"[^>]+href="([^"]+\.js)">/g,
    ),
  ].map((match) => match[1])
}

async function sumDistFileSizes(fileNames) {
  const sizes = await Promise.all(fileNames.map(readDistFileSize))

  return sizes.reduce((sum, size) => sum + size, 0)
}

async function readDistFileSize(fileName) {
  const normalizedFileName = fileName.replace(/^\//, '')
  const filePath = path.join(distDirectory, normalizedFileName)
  const stats = await stat(filePath)

  return stats.size
}

function readBudgetKilobytes(name, defaultValue) {
  const value = process.env[name]

  if (!value) {
    return defaultValue * 1024
  }

  const kilobytes = Number(value)

  assert.ok(
    Number.isFinite(kilobytes) && kilobytes > 0,
    `${name} must be a positive number of kilobytes.`,
  )

  return kilobytes * 1024
}
