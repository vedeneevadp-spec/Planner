import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  applyAppVersion,
  findVersionProblems,
  parseVersionArgs,
  readVersionFiles,
  readVersionSources,
} from './app-version.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const files = {
  androidGradle: [
    'android {',
    '    defaultConfig {',
    '        versionCode 51',
    '        versionName "1.1.43"',
    '    }',
    '}',
    '',
  ].join('\n'),
  iosProject: [
    '\t\t\t\tCURRENT_PROJECT_VERSION = 51;',
    '\t\t\t\tMARKETING_VERSION = 1.1.43;',
    '\t\t\t\tCURRENT_PROJECT_VERSION = 51;',
    '\t\t\t\tMARKETING_VERSION = 1.1.43;',
    '',
  ].join('\n'),
  packageJson:
    '{\n  "name": "planner",\n  "version": "1.1.43",\n  "private": true\n}\n',
  packageLock:
    '{\n  "name": "planner",\n  "version": "1.1.43",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "planner",\n      "version": "1.1.43"\n    },\n    "node_modules/x": {\n      "version": "9.9.9"\n    }\n  }\n}\n',
  releaseNotes:
    '# Release notes\n\n## Unreleased\n\n## v1.1.43 - 2026-11-15\n\n## v1.1.42 - 2026-11-14\n',
}

test('the repository version sources agree', async () => {
  assert.deepEqual(
    findVersionProblems(
      readVersionSources(await readVersionFiles(repositoryRoot)),
    ),
    [],
  )
})

test('reads every version place and accepts consistent sources', () => {
  assert.deepEqual(readVersionSources(files), {
    androidVersionCode: '51',
    androidVersionName: '1.1.43',
    iosBuildNumbers: ['51', '51'],
    iosMarketingVersions: ['1.1.43', '1.1.43'],
    packageLockVersions: ['1.1.43', '1.1.43'],
    packageVersion: '1.1.43',
    releaseNotesVersion: '1.1.43',
  })
  assert.deepEqual(findVersionProblems(readVersionSources(files)), [])
})

test('reports every place that drifted from package.json', () => {
  const drifted = {
    androidGradle: files.androidGradle.replace(
      'versionName "1.1.43"',
      'versionName "1.1.44"',
    ),
    iosProject: files.iosProject.replace(
      'CURRENT_PROJECT_VERSION = 51;',
      'CURRENT_PROJECT_VERSION = 50;',
    ),
    packageJson: files.packageJson.replace('1.1.43', '1.0.0'),
    packageLock: files.packageLock,
    releaseNotes: files.releaseNotes,
  }
  const problems = findVersionProblems(readVersionSources(drifted)).join('\n')

  assert.match(
    problems,
    /package-lock\.json version 1\.1\.43 != package\.json 1\.0\.0/,
  )
  assert.match(
    problems,
    /Android versionName 1\.1\.44 != package\.json 1\.0\.0/,
  )
  assert.match(
    problems,
    /iOS MARKETING_VERSION 1\.1\.43 != package\.json 1\.0\.0/,
  )
  assert.match(
    problems,
    /iOS CURRENT_PROJECT_VERSION 50 != Android versionCode 51/,
  )
  assert.match(
    problems,
    /newest release notes section is v1\.1\.43, expected v1\.0\.0/,
  )
})

test('requires a release notes section for a bumped version', () => {
  const bumped = applyAppVersion(files, { build: '52', version: '1.1.44' })

  assert.deepEqual(findVersionProblems(readVersionSources(bumped)), [
    'newest release notes section is v1.1.43, expected v1.1.44 (docs/release-notes.md)',
  ])
})

test('sets version and build everywhere except release notes', () => {
  const next = applyAppVersion(files, { build: '52', version: '1.2.0' })
  const sources = readVersionSources(next)

  assert.equal(sources.packageVersion, '1.2.0')
  assert.deepEqual(sources.packageLockVersions, ['1.2.0', '1.2.0'])
  assert.equal(sources.androidVersionName, '1.2.0')
  assert.equal(sources.androidVersionCode, '52')
  assert.deepEqual(sources.iosMarketingVersions, ['1.2.0', '1.2.0'])
  assert.deepEqual(sources.iosBuildNumbers, ['52', '52'])
  assert.equal(next.releaseNotes, files.releaseNotes)
  assert.match(
    next.packageLock,
    /"node_modules\/x": \{\n {6}"version": "9\.9\.9"/,
  )

  const buildOnly = applyAppVersion(files, { build: '60', version: undefined })

  assert.equal(readVersionSources(buildOnly).packageVersion, '1.1.43')
  assert.equal(readVersionSources(buildOnly).androidVersionCode, '60')
})

test('validates set arguments', () => {
  assert.deepEqual(parseVersionArgs([]), {
    build: undefined,
    set: false,
    version: undefined,
  })
  assert.deepEqual(
    parseVersionArgs(['--set', '--version=1.2.3', '--build=7']),
    {
      build: '7',
      set: true,
      version: '1.2.3',
    },
  )
  assert.throws(() => parseVersionArgs(['--version=1.2.3']), /need --set/)
  assert.throws(() => parseVersionArgs(['--set']), /Pass --version/)
  assert.throws(() => parseVersionArgs(['--set', '--version=1.2']), /1\.2\.3/)
  assert.throws(
    () => parseVersionArgs(['--set', '--build=0']),
    /positive integer/,
  )
  assert.throws(() => parseVersionArgs(['--oops']), /Unknown option/)
})
