import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const distDirectory = path.join(repoRoot, 'apps', 'web', 'dist')
const distAssetsDirectory = path.join(distDirectory, 'assets')
const indexHtmlPath = path.join(distDirectory, 'index.html')
const publicSelfCareDirectory = path.join(
  repoRoot,
  'apps',
  'web',
  'public',
  'self-care',
)
const publicIconsDirectory = path.join(
  repoRoot,
  'apps',
  'web',
  'public',
  'icons',
)

const initialJsMaxBytes = readBudgetKilobytes(
  'WEB_BUNDLE_INITIAL_JS_MAX_KB',
  835,
)
const entryJsMaxBytes = readBudgetKilobytes('WEB_BUNDLE_ENTRY_JS_MAX_KB', 250)
const routeAssetBudgets = [
  {
    defaultMaxKb: 125,
    extension: '.js',
    label: 'self-care route JS',
    prefix: 'self-care-',
    variable: 'WEB_BUNDLE_SELF_CARE_JS_MAX_KB',
  },
  {
    defaultMaxKb: 40,
    extension: '.css',
    label: 'self-care route CSS',
    prefix: ['self-care-', 'SelfCarePage-'],
    variable: 'WEB_BUNDLE_SELF_CARE_CSS_MAX_KB',
  },
  {
    defaultMaxKb: 55,
    extension: '.js',
    label: 'calendar route JS',
    prefix: 'calendar-',
    variable: 'WEB_BUNDLE_CALENDAR_JS_MAX_KB',
  },
  {
    defaultMaxKb: 32,
    extension: '.css',
    label: 'calendar route CSS',
    prefix: 'calendar-',
    variable: 'WEB_BUNDLE_CALENDAR_CSS_MAX_KB',
  },
  {
    defaultMaxKb: 110,
    extension: '.js',
    label: 'voice assistant JS',
    prefix: 'VoiceAssistant-',
    variable: 'WEB_BUNDLE_VOICE_ASSISTANT_JS_MAX_KB',
  },
  {
    defaultMaxKb: 15,
    extension: '.css',
    label: 'voice assistant CSS',
    prefix: 'VoiceAssistant-',
    variable: 'WEB_BUNDLE_VOICE_ASSISTANT_CSS_MAX_KB',
  },
  {
    defaultMaxKb: 210,
    extension: '.js',
    label: 'planner contracts JS',
    prefix: 'planner-contracts-',
    variable: 'WEB_BUNDLE_PLANNER_CONTRACTS_JS_MAX_KB',
  },
  {
    defaultMaxKb: 230,
    extension: '.js',
    label: 'lottie canvas JS',
    prefix: 'lottie_light_canvas-',
    variable: 'WEB_BUNDLE_LOTTIE_CANVAS_JS_MAX_KB',
  },
]
const publicAssetBudgets = [
  {
    defaultMaxKb: 13_312,
    directory: publicSelfCareDirectory,
    label: 'public self-care assets',
    variable: 'WEB_PUBLIC_SELF_CARE_ASSETS_MAX_KB',
  },
  {
    defaultMaxKb: 800,
    directory: publicIconsDirectory,
    label: 'public icon assets',
    variable: 'WEB_PUBLIC_ICON_ASSETS_MAX_KB',
  },
]
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
const routeAssetSizes = await Promise.all(
  routeAssetBudgets.map(async (budget) => ({
    ...budget,
    maxBytes: readBudgetKilobytes(budget.variable, budget.defaultMaxKb),
    size: await sumDistAssetFilesByPrefix(budget.prefix, budget.extension),
  })),
)
const publicAssetSizes = await Promise.all(
  publicAssetBudgets.map(async (budget) => ({
    ...budget,
    maxBytes: readBudgetKilobytes(budget.variable, budget.defaultMaxKb),
    size: await sumDirectorySize(budget.directory),
  })),
)

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

for (const budget of routeAssetSizes) {
  assert.ok(
    budget.size <= budget.maxBytes,
    `${budget.label} is ${formatKilobytes(budget.size)}; budget is ${formatKilobytes(budget.maxBytes)} (${budget.variable}).`,
  )
}

for (const budget of publicAssetSizes) {
  assert.ok(
    budget.size <= budget.maxBytes,
    `${budget.label} is ${formatKilobytes(budget.size)}; budget is ${formatKilobytes(budget.maxBytes)} (${budget.variable}).`,
  )
}

console.log(
  [
    'Web bundle budget check passed.',
    `Entry JS: ${formatKilobytes(entrySize)}.`,
    `Initial JS: ${formatKilobytes(initialJsSize)}.`,
    ...routeAssetSizes.map(
      (budget) => `${budget.label}: ${formatKilobytes(budget.size)}.`,
    ),
    ...publicAssetSizes.map(
      (budget) => `${budget.label}: ${formatKilobytes(budget.size)}.`,
    ),
  ].join(' '),
)

async function readText(filePath) {
  return readFile(filePath, 'utf8')
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

async function sumDistAssetFilesByPrefix(prefix, extension) {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix]
  const fileNames = await readdir(distAssetsDirectory)
  const matchedFileNames = fileNames.filter(
    (fileName) =>
      prefixes.some((candidate) => fileName.startsWith(candidate)) &&
      fileName.endsWith(extension),
  )

  assert.ok(
    matchedFileNames.length > 0,
    `Could not find dist asset matching ${prefixes.join(' or ')}*${extension}.`,
  )

  const sizes = await Promise.all(
    matchedFileNames.map((fileName) => readDistFileSize(`/assets/${fileName}`)),
  )

  return sizes.reduce((sum, size) => sum + size, 0)
}

async function sumDirectorySize(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name)

      if (entry.isDirectory()) {
        return sumDirectorySize(entryPath)
      }

      if (!entry.isFile()) {
        return 0
      }

      const stats = await stat(entryPath)

      return stats.size
    }),
  )

  return sizes.reduce((sum, size) => sum + size, 0)
}

function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
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
