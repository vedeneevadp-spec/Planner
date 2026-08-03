import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { assertAndroidFirebaseConfig } from './mobile-release-android-config.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

void describe('Android Firebase release config', () => {
  void it('accepts a complete config for the release application id', async () => {
    const filePath = await writeConfig(createConfig('ru.chaotika.app'))

    await assert.doesNotReject(
      assertAndroidFirebaseConfig({
        applicationId: 'ru.chaotika.app',
        filePath,
      }),
    )
  })

  void it('rejects a missing config', async () => {
    const directory = await createTemporaryDirectory()

    await assert.rejects(
      assertAndroidFirebaseConfig({
        applicationId: 'ru.chaotika.app',
        filePath: path.join(directory, 'google-services.json'),
      }),
      /Firebase config was not found/,
    )
  })

  void it('rejects invalid JSON', async () => {
    const filePath = await writeConfig('{')

    await assert.rejects(
      assertAndroidFirebaseConfig({
        applicationId: 'ru.chaotika.app',
        filePath,
      }),
      /not valid JSON/,
    )
  })

  void it('rejects a config for another application id', async () => {
    const filePath = await writeConfig(createConfig('com.example.other'))

    await assert.rejects(
      assertAndroidFirebaseConfig({
        applicationId: 'ru.chaotika.app',
        filePath,
      }),
      /does not contain a client for ru\.chaotika\.app/,
    )
  })

  void it('rejects an incomplete matching client', async () => {
    const config = createConfig('ru.chaotika.app')
    config.client[0].api_key = []
    const filePath = await writeConfig(config)

    await assert.rejects(
      assertAndroidFirebaseConfig({
        applicationId: 'ru.chaotika.app',
        filePath,
      }),
      /Firebase config is incomplete/,
    )
  })
})

function createConfig(packageName) {
  return {
    client: [
      {
        api_key: [{ current_key: 'test-api-key' }],
        client_info: {
          android_client_info: { package_name: packageName },
          mobilesdk_app_id: '1:123456789:android:test',
        },
      },
    ],
    project_info: { project_id: 'chaotika-test' },
  }
}

async function writeConfig(value) {
  const directory = await createTemporaryDirectory()
  const filePath = path.join(directory, 'google-services.json')
  await writeFile(
    filePath,
    typeof value === 'string' ? value : JSON.stringify(value),
    'utf8',
  )
  return filePath
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'planner-firebase-'))
  temporaryDirectories.push(directory)
  return directory
}
