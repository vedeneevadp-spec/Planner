import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertForwardUpdate,
  createUpdateManifest,
  remotePublishScript,
} from './publish-android-update.mjs'

const input = {
  badging:
    "package: name='ru.chaotika.app' versionCode='36' versionName='1.1.28'\nsdkVersion:'24'\nnative-code: 'arm64-v8a'\n",
  signature:
    'Signer #1 certificate SHA-256 digest: 2e1f24f672741d480091e6756bbb90666e5324eb1d1d8e529fae53007c13bb3d',
  bytes: 6000000,
  sha256: 'a'.repeat(64),
  notes: ' Обновления внутри приложения.\n',
}

test('prepares an immutable APK location and bounded manifest for the installed clients', () => {
  assert.deepEqual(createUpdateManifest(input), {
    formatVersion: 1,
    packageName: 'ru.chaotika.app',
    versionCode: 36,
    versionName: '1.1.28',
    minSdk: 24,
    abi: 'arm64-v8a',
    sizeBytes: 6000000,
    sha256: 'a'.repeat(64),
    notes: 'Обновления внутри приложения.',
    url: 'https://chaotika.ru/android-updates/Chaotika-1.1.28-build36-arm64-v8a.apk',
  })
})

test('rejects another signer, package, debug build, ABI and unsafe manifest values', () => {
  for (const change of [
    { signature: input.signature.replace('2e1f24', '000000') },
    { badging: input.badging.replace('ru.chaotika.app', 'another.app') },
    { badging: input.badging + 'application-debuggable\n' },
    { badging: input.badging.replace('arm64-v8a', 'x86_64') },
    { badging: input.badging.replace('1.1.28', '../../file') },
    { badging: input.badging.replace("sdkVersion:'24'", "sdkVersion:'0'") },
    { bytes: 81 * 1024 * 1024 },
    { sha256: 'bad' },
    { notes: '' },
    { notes: 'a'.repeat(2001) },
  ])
    assert.throws(() => createUpdateManifest({ ...input, ...change }))
})

test('allows idempotent publication but rejects downgrade and replacing an existing build', () => {
  const manifest = createUpdateManifest(input)
  assert.doesNotThrow(() => assertForwardUpdate(null, manifest))
  assert.doesNotThrow(() => assertForwardUpdate(manifest, manifest))
  assert.doesNotThrow(() =>
    assertForwardUpdate({ ...manifest, versionCode: 35 }, manifest),
  )
  assert.throws(
    () => assertForwardUpdate({ ...manifest, versionCode: 37 }, manifest),
    /older/,
  )
  assert.throws(
    () =>
      assertForwardUpdate({ ...manifest, sha256: 'b'.repeat(64) }, manifest),
    /replaced/,
  )
})

test('confines remote publication to a generated staging directory', () => {
  const manifest = createUpdateManifest(input)
  assert.throws(() => remotePublishScript('/tmp/../../', manifest))
  assert.throws(() =>
    remotePublishScript(
      '/opt/planner/shared/android-update-staging/00000000-0000-0000-0000-000000000000',
      { ...manifest, url: 'https://chaotika.ru/evil;command.apk' },
    ),
  )
  assert.doesNotThrow(() =>
    remotePublishScript(
      '/opt/planner/shared/android-update-staging/00000000-0000-0000-0000-000000000000',
      manifest,
    ),
  )
})

test('publishes complete files and preserves the previous release when verification fails', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'planner-update-publish-'),
  )
  const publicRoot = path.join(directory, 'public')
  const bytes = Buffer.from(
    'APK fixture; signing was checked before this publication phase',
  )
  const manifest = createUpdateManifest({
    ...input,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  const publish = async (next, uploadedBytes = bytes) => {
    const id = randomUUID()
    const remoteStage = `/opt/planner/shared/android-update-staging/${id}`
    const localStage = path.join(directory, id)
    await mkdir(localStage)
    await writeFile(path.join(localStage, 'latest.json'), JSON.stringify(next))
    await writeFile(
      path.join(localStage, new URL(next.url).pathname.split('/').at(-1)),
      uploadedBytes,
    )
    // Run the exact generated program, substituting only its three filesystem roots.
    const script = remotePublishScript(remoteStage, next)
      .replace(JSON.stringify(remoteStage), JSON.stringify(localStage))
      .replace(
        JSON.stringify('/var/lib/planner/android-updates'),
        JSON.stringify(publicRoot),
      )
      .replace(
        "'/var/lib/planner/.android-update-'",
        JSON.stringify(path.join(directory, '.android-update-')),
      )
    execFileSync(process.execPath, ['--input-type=module'], {
      input: script,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    await assert.rejects(readFile(path.join(localStage, 'latest.json')), {
      code: 'ENOENT',
    })
  }
  try {
    await publish(manifest)
    assert.deepEqual(
      JSON.parse(await readFile(path.join(publicRoot, 'latest.json'), 'utf8')),
      manifest,
    )
    assert.deepEqual(
      await readFile(
        path.join(publicRoot, new URL(manifest.url).pathname.split('/').at(-1)),
      ),
      bytes,
    )
    await publish(manifest)
    const newer = {
      ...manifest,
      versionCode: 37,
      url: manifest.url.replace('build36', 'build37'),
    }
    await assert.rejects(publish(newer, Buffer.from('broken')))
    assert.deepEqual(
      JSON.parse(await readFile(path.join(publicRoot, 'latest.json'), 'utf8')),
      manifest,
    )
    await publish(newer)
    await assert.rejects(publish(manifest))
    assert.deepEqual(
      JSON.parse(await readFile(path.join(publicRoot, 'latest.json'), 'utf8')),
      newer,
    )
    assert.deepEqual(
      await readFile(
        path.join(publicRoot, new URL(manifest.url).pathname.split('/').at(-1)),
      ),
      bytes,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
