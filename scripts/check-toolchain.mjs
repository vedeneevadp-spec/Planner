import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
)
const expectedNodeVersion = normalizeVersion(
  readFileSync(path.join(repoRoot, '.node-version'), 'utf8'),
)
const nvmNodeVersion = normalizeVersion(
  readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8'),
)
const expectedNpmVersion = readExpectedNpmVersion(packageJson.packageManager)
const actualNodeVersion = process.versions.node
const actualNpmVersion = readActualNpmVersion()
const unsupportedNpmEnvConfigs = [
  'NPM_CONFIG_MIN_RELEASE_AGE',
  'npm_config_min_release_age',
].filter((name) => process.env[name] !== undefined)
const violations = []

if (expectedNodeVersion !== nvmNodeVersion) {
  violations.push(
    `.node-version (${expectedNodeVersion}) and .nvmrc (${nvmNodeVersion}) must match.`,
  )
}

if (actualNodeVersion !== expectedNodeVersion) {
  violations.push(
    `Node ${actualNodeVersion} is active, but this project requires Node ${expectedNodeVersion}.`,
  )
}

if (actualNpmVersion !== expectedNpmVersion) {
  violations.push(
    `npm ${actualNpmVersion ?? 'unknown'} is active, but packageManager requires npm ${expectedNpmVersion}.`,
  )
}

if (unsupportedNpmEnvConfigs.length > 0) {
  violations.push(
    `Unsupported npm env config is set: ${unsupportedNpmEnvConfigs.join(', ')}. Unset it before running project checks.`,
  )
}

if (violations.length > 0) {
  console.error(
    [
      'Toolchain check failed.',
      ...violations.map((violation) => `- ${violation}`),
      '',
      'Use the pinned runtime before running project checks:',
      `- nvm install ${expectedNodeVersion} && nvm use ${expectedNodeVersion}`,
      `- npm install -g npm@${expectedNpmVersion}`,
      '- unset NPM_CONFIG_MIN_RELEASE_AGE npm_config_min_release_age',
      '',
      'If npm prints "Unknown env config \\"min-release-age\\"", remove the injected npm env config before running project commands.',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(
  `Toolchain check passed. Node ${actualNodeVersion}, npm ${actualNpmVersion}.`,
)

function normalizeVersion(value) {
  return value.trim().replace(/^v/, '')
}

function readExpectedNpmVersion(packageManager) {
  if (typeof packageManager !== 'string') {
    throw new Error('packageManager must be configured in package.json.')
  }

  const match = /^npm@(?<version>\d+\.\d+\.\d+)$/.exec(packageManager.trim())

  if (!match?.groups?.version) {
    throw new Error(`Unsupported packageManager value: ${packageManager}`)
  }

  return match.groups.version
}

function readActualNpmVersion() {
  try {
    return execFileSync('npm', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    const userAgent = process.env.npm_config_user_agent ?? ''
    const match = /\bnpm\/(?<version>\d+\.\d+\.\d+)\b/.exec(userAgent)

    return match?.groups?.version ?? null
  }
}
