#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { get } from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ACTIONLINT_VERSION = '1.7.12'
const ACTIONLINT_TAG = `v${ACTIONLINT_VERSION}`
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const TARGETS = {
  'darwin:arm64': 'darwin_arm64',
  'darwin:x64': 'darwin_amd64',
  'linux:arm64': 'linux_arm64',
  'linux:x64': 'linux_amd64',
}

const target = TARGETS[`${process.platform}:${process.arch}`]

if (!target) {
  throw new Error(
    `Unsupported platform for actionlint: ${process.platform}/${process.arch}`,
  )
}

const fileName = `actionlint_${ACTIONLINT_VERSION}_${target}.tar.gz`
const checksumsFileName = `actionlint_${ACTIONLINT_VERSION}_checksums.txt`
const releaseBaseUrl = `https://github.com/rhysd/actionlint/releases/download/${ACTIONLINT_TAG}`
const cacheDir = path.join(
  REPO_ROOT,
  'tmp',
  'tool-cache',
  'actionlint',
  ACTIONLINT_VERSION,
  target,
)
const archivePath = path.join(cacheDir, fileName)
const checksumsPath = path.join(cacheDir, checksumsFileName)
const binaryPath = path.join(cacheDir, 'actionlint')

await ensureActionlint()

const args = process.argv.slice(2)
const result = spawnSync(binaryPath, ['-no-color', ...args], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)

async function ensureActionlint() {
  if (await exists(binaryPath)) {
    return
  }

  await mkdir(cacheDir, { recursive: true })
  await downloadFile(`${releaseBaseUrl}/${checksumsFileName}`, checksumsPath)
  await downloadFile(`${releaseBaseUrl}/${fileName}`, archivePath)
  await verifyChecksum(archivePath, checksumsPath, fileName)
  extractArchive(archivePath, cacheDir)
  await chmod(binaryPath, 0o755)
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

async function downloadFile(url, destination) {
  await new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume()
        downloadFile(response.headers.location, destination)
          .then(resolve)
          .catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(
          new Error(`Failed to download ${url}: HTTP ${response.statusCode}`),
        )
        return
      }

      const file = createWriteStream(destination)
      response.pipe(file)
      file.on('finish', () => {
        file.close(resolve)
      })
      file.on('error', reject)
    })

    request.on('error', reject)
  })
}

async function verifyChecksum(archive, checksums, expectedFileName) {
  const expected = await readExpectedChecksum(checksums, expectedFileName)
  const actual = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')

  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${expectedFileName}: expected ${expected}, got ${actual}`,
    )
  }
}

async function readExpectedChecksum(checksums, expectedFileName) {
  const content = await readFile(checksums, 'utf8')
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.endsWith(`  ${expectedFileName}`))

  if (!line) {
    throw new Error(`Checksum for ${expectedFileName} was not found.`)
  }

  return line.split(/\s+/)[0]
}

function extractArchive(archive, destination) {
  const result = spawnSync(
    'tar',
    ['-xzf', archive, '-C', destination, 'actionlint'],
    {
      stdio: 'inherit',
    },
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Failed to extract actionlint archive on ${os.platform()}.`)
  }
}
