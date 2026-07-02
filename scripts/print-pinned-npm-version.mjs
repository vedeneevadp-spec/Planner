#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
)

const match = /^npm@(?<version>\d+\.\d+\.\d+)$/.exec(packageJson.packageManager)

if (!match?.groups?.version) {
  throw new Error(`Unsupported packageManager: ${packageJson.packageManager}`)
}

process.stdout.write(match.groups.version)
