#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const DEFAULT_ENV_FILE = '/etc/planner/planner.env'

const { command, envFile } = parseArguments(process.argv.slice(2))

if (command.length === 0) {
  console.error(
    'Usage: npm run prod:env -- [--env-file /path/to/env] <command> [args...]',
  )
  process.exit(1)
}

const fileEnv = parseEnvFile(readFileSync(envFile, 'utf8'))
const child = spawn(command[0], command.slice(1), {
  env: {
    ...process.env,
    ...fileEnv,
  },
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Command terminated by signal ${signal}.`)
    process.exit(1)
  }

  process.exit(code ?? 0)
})

function parseArguments(args) {
  let envFile = process.env.PROD_ENV_FILE ?? DEFAULT_ENV_FILE
  const command = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--') {
      command.push(...args.slice(index + 1))
      break
    }

    if (arg === '--env-file') {
      const value = args[index + 1]

      if (!value) {
        throw new Error('--env-file requires a path.')
      }

      envFile = value
      index += 1
      continue
    }

    command.push(...args.slice(index))
    break
  }

  return { command, envFile }
}

function parseEnvFile(text) {
  const values = {}

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    )

    if (!match) {
      continue
    }

    values[match[1]] = parseEnvValue(match[2])
  }

  return values
}

function parseEnvValue(rawValue) {
  let value = rawValue.trim()
  const commentIndex = findUnquotedCommentIndex(value)

  if (commentIndex >= 0) {
    value = value.slice(0, commentIndex).trim()
  }

  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]

    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      value = value.slice(1, -1)

      if (first === '"') {
        value = value.replace(/\\(["\\$`])/g, '$1')
      }
    }
  }

  return value
}

function findUnquotedCommentIndex(value) {
  let quote = null

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (char === '\\') {
      index += 1
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      }

      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (char === '#') {
      return index
    }
  }

  return -1
}
