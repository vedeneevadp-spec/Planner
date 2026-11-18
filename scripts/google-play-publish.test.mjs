import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import test from 'node:test'

import {
  createServiceAccountAssertion,
  describeGooglePlayFailure,
  extractGooglePlayNotes,
  parsePublishArgs,
  publishToGooglePlay,
  RELEASE_NOTES_LIMIT,
} from './google-play-publish.mjs'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
})
const key = {
  client_email: 'play-publisher@example.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: 'https://oauth2.example.test/token',
  type: 'service_account',
}
const releaseNotes = [
  '# Release notes',
  '',
  '## Unreleased',
  '',
  '## v1.1.44 - 2026-11-20',
  '',
  'Каналы: Web, Android',
  '',
  '- Длинный пункт для сайта.',
  '',
  '### Google Play',
  '',
  'Карточка дня на экране «Сегодня».',
  '',
  '### Техническое',
  '',
  '- Внутренние детали.',
  '',
  '## v1.1.43 - 2026-11-15',
  '',
  '- Старый выпуск.',
  '',
].join('\n')

function fakeGooglePlay({
  trackReleases = [],
  uploadedVersionCode = 52,
  fail,
} = {}) {
  const calls = []
  const respond = (status, payload) =>
    new Response(payload === undefined ? '' : JSON.stringify(payload), {
      status,
    })

  async function fetchImpl(url, init = {}) {
    const { pathname, search } = new URL(url)
    const route = `${init.method} ${pathname.replace(/^.*\/applications\/ru\.chaotika\.app/, '')}${search}`
    calls.push({ body: init.body, headers: init.headers, route })

    if (fail && route.startsWith(fail.route)) {
      return respond(fail.status, { error: { message: fail.message } })
    }
    if (url === key.token_uri)
      return respond(200, { access_token: 'test-token' })
    if (route === 'POST /edits') return respond(200, { id: 'edit-1' })
    if (route === 'GET /edits/edit-1/tracks/alpha') {
      return respond(200, { releases: trackReleases, track: 'alpha' })
    }
    if (route === 'POST /edits/edit-1/bundles?uploadType=media') {
      return respond(200, { versionCode: uploadedVersionCode })
    }
    if (route === 'PUT /edits/edit-1/tracks/alpha') return respond(200, {})
    if (route === 'POST /edits/edit-1:commit')
      return respond(200, { id: 'edit-1' })
    if (route === 'POST /edits/edit-1:validate')
      return respond(200, { id: 'edit-1' })
    if (route === 'DELETE /edits/edit-1') return respond(204)
    return respond(500, { error: { message: `unexpected ${route}` } })
  }

  return { calls, fetchImpl }
}

function publish(fake, overrides = {}) {
  return publishToGooglePlay({
    aab: new Blob(['aab']),
    dryRun: false,
    fetchImpl: fake.fetchImpl,
    key,
    log: () => {},
    notes: 'Карточка дня.',
    status: 'completed',
    track: 'alpha',
    versionCode: '52',
    versionName: '1.1.44',
    ...overrides,
  })
}

test('defaults to alpha and completed and never allows production', () => {
  assert.deepEqual(parsePublishArgs([]), {
    aab: null,
    dryRun: false,
    help: false,
    status: 'completed',
    track: 'alpha',
  })
  assert.equal(
    parsePublishArgs(['--track=internal', '--status=draft']).track,
    'internal',
  )
  assert.equal(parsePublishArgs(['--dry-run']).dryRun, true)
  assert.throws(
    () => parsePublishArgs(['--track=production']),
    /Production is published manually/,
  )
  assert.throws(() => parsePublishArgs(['--track=beta']), /internal or alpha/)
  assert.throws(
    () => parsePublishArgs(['--status=inProgress']),
    /draft or completed/,
  )
  assert.throws(() => parsePublishArgs(['--oops']), /Unknown option/)
})

test('takes "What\'s new" only from the version\'s Google Play subsection', () => {
  assert.equal(
    extractGooglePlayNotes(releaseNotes, '1.1.44'),
    'Карточка дня на экране «Сегодня».',
  )
  assert.throws(
    () => extractGooglePlayNotes(releaseNotes, '1.1.43'),
    /Add a "### Google Play" subsection/,
  )
  assert.throws(
    () => extractGooglePlayNotes(releaseNotes, '1.1.45'),
    /no "## v1\.1\.45" section/,
  )
  assert.throws(
    () =>
      extractGooglePlayNotes(
        releaseNotes.replace('Карточка дня на экране «Сегодня».', ''),
        '1.1.44',
      ),
    /is empty/,
  )
  assert.throws(
    () =>
      extractGooglePlayNotes(
        releaseNotes.replace(
          'Карточка дня на экране «Сегодня».',
          'x'.repeat(RELEASE_NOTES_LIMIT + 1),
        ),
        '1.1.44',
      ),
    /allows 500/,
  )
})

test('signs a short-lived JWT for the androidpublisher scope', () => {
  const now = new Date('2026-11-18T12:00:00.000Z')
  const [header, claims, signature] = createServiceAccountAssertion(
    key,
    now,
  ).split('.')
  const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'))

  assert.deepEqual(
    JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    {
      alg: 'RS256',
      typ: 'JWT',
    },
  )
  assert.deepEqual(decoded, {
    aud: key.token_uri,
    exp: now.getTime() / 1000 + 3600,
    iat: now.getTime() / 1000,
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
  })
  assert.equal(
    createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, 'base64url')),
    true,
  )
})

test('uploads, assigns the release to the track and commits in order', async () => {
  const fake = fakeGooglePlay({
    trackReleases: [{ status: 'completed', versionCodes: ['51'] }],
  })

  assert.deepEqual(await publish(fake), { warnings: [] })
  assert.deepEqual(
    fake.calls.map((call) => call.route),
    [
      'POST /token',
      'POST /edits',
      'GET /edits/edit-1/tracks/alpha',
      'POST /edits/edit-1/bundles?uploadType=media',
      'PUT /edits/edit-1/tracks/alpha',
      'POST /edits/edit-1:commit',
    ],
  )

  const upload = fake.calls[3]
  assert.equal(upload.headers['content-type'], 'application/octet-stream')
  assert.equal(upload.headers.authorization, 'Bearer test-token')
  assert.deepEqual(JSON.parse(fake.calls[4].body), {
    releases: [
      {
        name: '1.1.44 (52)',
        releaseNotes: [{ language: 'ru-RU', text: 'Карточка дня.' }],
        status: 'completed',
        versionCodes: ['52'],
      },
    ],
    track: 'alpha',
  })
})

test('dry run validates and discards the edit without uploading', async () => {
  const fake = fakeGooglePlay({ trackReleases: [{ versionCodes: ['52'] }] })
  const result = await publish(fake, { aab: null, dryRun: true })

  assert.deepEqual(
    fake.calls.map((call) => call.route),
    [
      'POST /token',
      'POST /edits',
      'GET /edits/edit-1/tracks/alpha',
      'POST /edits/edit-1:validate',
      'DELETE /edits/edit-1',
    ],
  )
  assert.match(
    result.warnings.join('\n'),
    /versionCode 52 is not greater than 52/,
  )
})

test('refuses a used versionCode or a mismatched AAB and discards the edit', async () => {
  const used = fakeGooglePlay({ trackReleases: [{ versionCodes: ['52'] }] })
  await assert.rejects(publish(used), /versionCode 52 is not greater than 52/)
  assert.equal(used.calls.at(-1).route, 'DELETE /edits/edit-1')
  assert.ok(!used.calls.some((call) => call.route.includes('bundles')))

  const mismatched = fakeGooglePlay({ uploadedVersionCode: 51 })
  await assert.rejects(
    publish(mismatched),
    /Uploaded AAB has versionCode 51, expected 52/,
  )
  assert.ok(!mismatched.calls.some((call) => call.route.endsWith(':commit')))
  assert.equal(mismatched.calls.at(-1).route, 'DELETE /edits/edit-1')
})

test('explains access errors without leaking the access token', async () => {
  const fake = fakeGooglePlay({
    fail: {
      message: 'The caller does not have permission (test-token)',
      route: 'GET /edits/edit-1/tracks',
      status: 403,
    },
  })

  await assert.rejects(publish(fake), (error) => {
    assert.match(error.message, /HTTP 403/)
    assert.match(error.message, /Release to testing tracks/)
    assert.doesNotMatch(error.message, /test-token/)
    assert.doesNotMatch(error.message, /PRIVATE KEY/)
    return true
  })
  assert.match(
    describeGooglePlayFailure(403, {
      error: {
        message:
          'Google Play Android Developer API has not been used in project 1 before or it is disabled.',
      },
    }),
    /Enable "Google Play Android Developer API"/,
  )
})
