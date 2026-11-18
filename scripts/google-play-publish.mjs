// Uploads the signed Google Play AAB to a testing track through the
// Google Play Developer API (androidpublisher v3) with a service account.
//
//   npm run mobile:publish:google-play            upload to alpha, status completed
//   npm run mobile:publish:google-play:dry-run    check access, version and notes only
//
// Build the AAB first: npm run mobile:release:google-play -- --api-url=...
// Production is never a valid target: only internal and alpha tracks.
import { createSign } from 'node:crypto'
import { existsSync, openAsBlob } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  findVersionProblems,
  readVersionFiles,
  readVersionSources,
} from './app-version.mjs'
import { assertGooglePlayArtifact } from './google-play-artifact.mjs'
import { parseEnvFile } from './notify-telegram.mjs'

export const GOOGLE_PLAY_PACKAGE = 'ru.chaotika.app'
export const ALLOWED_TRACKS = new Set(['internal', 'alpha'])
export const ALLOWED_STATUSES = new Set(['draft', 'completed'])
export const RELEASE_NOTES_LIMIT = 500
const RELEASE_NOTES_LANGUAGE = 'ru-RU'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
const API_ROOT = 'https://androidpublisher.googleapis.com'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const DEFAULT_ENV_FILE = '.env.google-play.local'
const DEFAULT_AAB = 'android/app/build/outputs/bundle/release/app-release.aab'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

async function main(argv) {
  const options = parsePublishArgs(argv)

  if (options.help) {
    printHelp()
    return
  }

  const warnings = []
  const fail = (message) => {
    if (!options.dryRun) {
      throw new Error(message)
    }
    warnings.push(message)
  }

  const files = await readVersionFiles(repositoryRoot)
  const sources = readVersionSources(files)
  const versionProblems = findVersionProblems(sources)

  if (versionProblems.length > 0) {
    fail(
      [
        '[google-play] App version sources disagree (npm run version:check):',
        ...versionProblems.map((problem) => `  - ${problem}`),
      ].join('\n'),
    )
  }

  const versionName = sources.packageVersion
  const versionCode = sources.androidVersionCode
  let notes = null

  try {
    notes = extractGooglePlayNotes(files.releaseNotes, versionName)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }

  const aabPath = path.resolve(repositoryRoot, options.aab ?? DEFAULT_AAB)
  let aab = null

  if (existsSync(aabPath)) {
    await assertGooglePlayArtifact(aabPath)
    aab = { path: aabPath, size: (await stat(aabPath)).size }
  } else {
    fail(
      `[google-play] AAB not found: ${path.relative(repositoryRoot, aabPath)}. Build it with npm run mobile:release:google-play -- --api-url=https://chaotika.ru`,
    )
  }

  const key = await readServiceAccountKey()

  console.log(
    [
      `[google-play] ${options.dryRun ? 'Dry run' : 'Publishing'}: ${GOOGLE_PLAY_PACKAGE} ${versionName} (${versionCode})`,
      `  track:   ${options.track}`,
      `  status:  ${options.status}`,
      `  account: ${key.client_email}`,
      aab
        ? `  aab:     ${path.relative(repositoryRoot, aab.path)} (${formatMegabytes(aab.size)})`
        : '  aab:     -',
    ].join('\n'),
  )

  const result = await publishToGooglePlay({
    aab: aab && !options.dryRun ? await openAsBlob(aab.path) : null,
    dryRun: options.dryRun,
    fetchImpl: fetch,
    key,
    log: (line) => console.log(line),
    notes,
    status: options.status,
    track: options.track,
    versionCode,
    versionName,
  })

  for (const warning of [...warnings, ...result.warnings]) {
    console.warn(
      `[google-play] WARNING: ${warning.replace(/^\[google-play\] /, '')}`,
    )
  }

  if (options.dryRun) {
    console.log(
      warnings.length + result.warnings.length === 0
        ? '[google-play] Dry run passed: access, track, version and release notes are ready.'
        : '[google-play] Dry run: access works; fix the warnings above before publishing.',
    )
    return
  }

  console.log(
    options.status === 'completed'
      ? `[google-play] ${versionName} (${versionCode}) sent to ${options.track} and submitted for review.`
      : `[google-play] ${versionName} (${versionCode}) saved as a draft in ${options.track}; send it for review in Play Console.`,
  )
}

export function parsePublishArgs(argv) {
  const options = {
    aab: null,
    dryRun: false,
    help: false,
    status: 'completed',
    track: 'alpha',
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg.startsWith('--track=')) {
      options.track = arg.slice('--track='.length)
    } else if (arg.startsWith('--status=')) {
      options.status = arg.slice('--status='.length)
    } else if (arg.startsWith('--aab=')) {
      options.aab = arg.slice('--aab='.length)
    } else {
      throw new Error(`[google-play] Unknown option: ${arg}`)
    }
  }

  if (!ALLOWED_TRACKS.has(options.track)) {
    throw new Error(
      `[google-play] Track must be internal or alpha, got "${options.track}". Production is published manually.`,
    )
  }

  if (!ALLOWED_STATUSES.has(options.status)) {
    throw new Error(
      `[google-play] Status must be draft or completed, got "${options.status}".`,
    )
  }

  return options
}

export function extractGooglePlayNotes(releaseNotes, version) {
  const lines = releaseNotes.split(/\r?\n/)
  const start = lines.findIndex((line) =>
    new RegExp(`^## v${escapeRegExp(version)}(?:\\s|$)`).test(line),
  )

  if (start === -1) {
    throw new Error(
      `[google-play] docs/release-notes.md has no "## v${version}" section.`,
    )
  }

  const sectionEnd = lines.findIndex(
    (line, index) => index > start && /^## /.test(line),
  )
  const section = lines.slice(
    start + 1,
    sectionEnd === -1 ? undefined : sectionEnd,
  )
  const notesStart = section.findIndex((line) =>
    /^### Google Play\s*$/.test(line),
  )

  if (notesStart === -1) {
    throw new Error(
      `[google-play] Add a "### Google Play" subsection (up to ${RELEASE_NOTES_LIMIT} characters) to "## v${version}" in docs/release-notes.md.`,
    )
  }

  const notesEnd = section.findIndex(
    (line, index) => index > notesStart && /^#{1,3} /.test(line),
  )
  const text = unwrapMarkdownLines(
    section.slice(notesStart + 1, notesEnd === -1 ? undefined : notesEnd),
  )

  if (text === '') {
    throw new Error(
      `[google-play] The "### Google Play" subsection of v${version} is empty.`,
    )
  }

  if (text.length > RELEASE_NOTES_LIMIT) {
    throw new Error(
      `[google-play] "### Google Play" notes for v${version} are ${text.length} characters; Google Play allows ${RELEASE_NOTES_LIMIT}.`,
    )
  }

  return text
}

export function createServiceAccountAssertion(key, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    aud: key.token_uri ?? DEFAULT_TOKEN_URI,
    exp: issuedAt + 3600,
    iat: issuedAt,
    iss: key.client_email,
    scope: SCOPE,
  }
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(key.private_key)

  return `${unsigned}.${base64Url(signature)}`
}

export async function publishToGooglePlay({
  aab,
  dryRun,
  fetchImpl,
  key,
  log,
  notes,
  now = new Date(),
  status,
  track,
  versionCode,
  versionName,
}) {
  const warnings = []
  const token = await requestAccessToken(fetchImpl, key, now)
  const appPath = `/androidpublisher/v3/applications/${GOOGLE_PLAY_PACKAGE}`
  const call = (method, pathname, init = {}) =>
    callGooglePlay(fetchImpl, token, method, `${API_ROOT}${pathname}`, init)

  const edit = await call('POST', `${appPath}/edits`, { json: {} })
  const editPath = `${appPath}/edits/${edit.id}`
  let committed = false

  try {
    const current = await call('GET', `${editPath}/tracks/${track}`, {
      allowNotFound: true,
    })
    const usedCodes = (current?.releases ?? []).flatMap((release) =>
      (release.versionCodes ?? []).map(Number),
    )
    const highest = usedCodes.length > 0 ? Math.max(...usedCodes) : null

    log(
      `[google-play] Access OK. ${track} currently has ${highest === null ? 'no releases' : `versionCode up to ${highest}`}.`,
    )

    if (highest !== null && Number(versionCode) <= highest) {
      const message = `versionCode ${versionCode} is not greater than ${highest} already in ${track}; bump it with npm run version:set.`
      if (!dryRun) {
        throw new Error(`[google-play] ${message}`)
      }
      warnings.push(message)
    }

    if (dryRun) {
      await call('POST', `${editPath}:validate`)
      log('[google-play] Edit validated; nothing was uploaded or published.')
      return { warnings }
    }

    if (!aab) {
      throw new Error('[google-play] AAB is required to publish.')
    }

    log('[google-play] Uploading AAB...')
    const bundle = await call(
      'POST',
      `/upload${editPath}/bundles?uploadType=media`,
      { body: aab, contentType: 'application/octet-stream' },
    )

    if (String(bundle.versionCode) !== String(versionCode)) {
      throw new Error(
        `[google-play] Uploaded AAB has versionCode ${bundle.versionCode}, expected ${versionCode}. Rebuild the AAB after npm run version:set.`,
      )
    }

    await call('PUT', `${editPath}/tracks/${track}`, {
      json: {
        releases: [
          {
            name: `${versionName} (${versionCode})`,
            releaseNotes: [{ language: RELEASE_NOTES_LANGUAGE, text: notes }],
            status,
            versionCodes: [String(versionCode)],
          },
        ],
        track,
      },
    })
    await call('POST', `${editPath}:commit`)
    committed = true

    return { warnings }
  } finally {
    if (!committed) {
      await call('DELETE', editPath).catch(() => {})
    }
  }
}

export function describeGooglePlayFailure(status, payload) {
  const message = payload?.error?.message ?? 'no message'
  const hints = []

  if (/has not been used in project|is disabled/i.test(message)) {
    hints.push(
      'Enable "Google Play Android Developer API" in the service account\'s Google Cloud project.',
    )
  } else if (status === 401 || status === 403) {
    hints.push(
      'Check that the service account is invited in Play Console (Users and permissions) with "Release to testing tracks" for this app; new permissions can take up to a day.',
    )
  }

  if (/changesNotSentForReview/i.test(message)) {
    hints.push(
      'Play Console has changes that must be sent for review manually; send them in Play Console, then retry.',
    )
  }

  return [`HTTP ${status}: ${message}`, ...hints].join('\n')
}

async function requestAccessToken(fetchImpl, key, now) {
  const response = await fetchImpl(key.token_uri ?? DEFAULT_TOKEN_URI, {
    body: new URLSearchParams({
      assertion: createServiceAccountAssertion(key, now),
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }),
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || typeof payload?.access_token !== 'string') {
    throw new Error(
      `[google-play] Service account sign-in failed (HTTP ${response.status}): ${payload?.error_description ?? payload?.error ?? 'no description'}. Is the key current and not revoked?`,
    )
  }

  return payload.access_token
}

async function callGooglePlay(fetchImpl, token, method, url, init) {
  const headers = { authorization: `Bearer ${token}` }
  let body

  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  } else if (init.body !== undefined) {
    headers['content-type'] = init.contentType
    body = init.body
  }

  const response = await fetchImpl(url, {
    body,
    headers,
    method,
    signal: AbortSignal.timeout(10 * 60_000),
  })

  if (init.allowNotFound && response.status === 404) {
    return null
  }

  const text = await response.text()
  const payload = text ? safeJson(text) : null

  if (!response.ok) {
    const action = `${method} ${new URL(url).pathname.replace(/^.*\/applications\/[^/]+/, '')}`
    throw new Error(
      `[google-play] ${action} failed. ${describeGooglePlayFailure(response.status, payload)}`.replaceAll(
        token,
        '<redacted>',
      ),
    )
  }

  return payload ?? {}
}

async function readServiceAccountKey() {
  const envFile = path.join(repositoryRoot, DEFAULT_ENV_FILE)
  const fileEnv = existsSync(envFile)
    ? parseEnvFile(await readFile(envFile, 'utf8'))
    : {}
  const keyPath =
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ||
    fileEnv.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON

  if (!keyPath) {
    throw new Error(
      `[google-play] Set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON to the service account key path (environment or ${DEFAULT_ENV_FILE}).`,
    )
  }

  let key

  try {
    key = JSON.parse(await readFile(keyPath, 'utf8'))
  } catch {
    throw new Error(
      '[google-play] Cannot read the service account key from GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.',
    )
  }

  if (
    key?.type !== 'service_account' ||
    typeof key.client_email !== 'string' ||
    typeof key.private_key !== 'string'
  ) {
    throw new Error(
      '[google-play] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON does not point to a service account JSON key.',
    )
  }

  return key
}

// Markdown is hard-wrapped at ~80 columns, while Play shows every newline.
// Join wrapped lines of a paragraph or list item with spaces; keep paragraphs
// apart with a blank line and list items on their own lines.
function unwrapMarkdownLines(lines) {
  const blocks = []
  let current = null

  for (const raw of lines) {
    const line = raw.trim()

    if (line === '') {
      current = null
      continue
    }

    if (/^[-*] /.test(line) || current === null) {
      current = { listItem: /^[-*] /.test(line), text: line }
      blocks.push(current)
    } else {
      current.text += ` ${line}`
    }
  }

  return blocks
    .map((block, index) => {
      const previous = blocks[index - 1]
      const separator =
        index === 0 ? '' : block.listItem && previous?.listItem ? '\n' : '\n\n'
      return `${separator}${block.text}`
    })
    .join('')
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function printHelp() {
  console.log(`
Usage:
  npm run mobile:publish:google-play [-- options]

Uploads the built Google Play AAB to a testing track. Version comes from
package.json (npm run version:check must pass); "What's new" comes from the
"### Google Play" subsection of "## vX.Y.Z" in docs/release-notes.md.

Options:
  --dry-run              sign in, read the track and validate an empty edit;
                         upload and publish nothing
  --track=alpha|internal default alpha (production is never allowed)
  --status=completed|draft
                         default completed: submitted for review right away
  --aab=path             default ${DEFAULT_AAB}

Credentials:
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — path to the service account JSON key,
  from the environment or ${DEFAULT_ENV_FILE} (git-ignored).
`)
}
