import assert from 'node:assert/strict'
import test from 'node:test'

import { assertGooglePlayContents } from './google-play-artifact.mjs'

const bundle = {
  manifest: 'manifest ru.chaotika.app INTERNET POST_NOTIFICATIONS',
  dex: 'MainActivity PlannerWidgetPlugin',
  entries: [
    'base/assets/public/index.html',
    'base/assets/public/assets/index.js',
  ],
}

test('accepts a Play bundle with application assets', () => {
  assert.doesNotThrow(() => assertGooglePlayContents(bundle))
})

test('rejects an install permission, native updater, or accidentally bundled web updater independently', () => {
  for (const invalid of [
    { manifest: `${bundle.manifest} REQUEST_INSTALL_PACKAGES` },
    { dex: `${bundle.dex} PlannerAppUpdatesPlugin` },
    {
      entries: [
        ...bundle.entries,
        'base/assets/public/assets/NativeAppUpdates-abc.js',
      ],
    },
    { manifest: 'com.example.other' },
    { entries: ['base/assets/public/assets/index.js'] },
  ]) {
    assert.throws(() => assertGooglePlayContents({ ...bundle, ...invalid }))
  }
})
