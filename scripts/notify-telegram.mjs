import { openAsBlob } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const TELEGRAM_LIMITS = {
  captionChars: 1024,
  documentBytes: 50 * 1024 * 1024,
  messageChars: 4096,
}

const DEFAULT_ENV_FILE = '.env.telegram.local'
const TARGET_ENV = {
  group: 'TELEGRAM_GROUP_CHAT_ID',
  personal: 'TELEGRAM_CHAT_ID',
}

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
  const options = parseNotifyArgs(argv)

  if (options.help) {
    printHelp()
    return
  }

  const fileEnv = await readEnvFile(
    process.env.TELEGRAM_ENV_FILE ?? DEFAULT_ENV_FILE,
  )
  const target = resolveTelegramTarget({
    env: process.env,
    fileEnv,
    to: options.to,
  })
  const text = await readOptionalText(options.text, options.textFile)
  const caption = await readOptionalText(options.caption, options.captionFile)
  const document = options.file ? await describeDocument(options.file) : null
  const plan = createDeliveryPlan({ caption, document, text })

  if (options.dryRun) {
    printDryRun(plan, options.to)
    return
  }

  try {
    for (const step of plan) {
      await sendStep(step, target)
      console.log(`[telegram] Sent ${describeStep(step)} to ${options.to}.`)
    }
  } catch (error) {
    throw new Error(
      redactSecret(
        error instanceof Error ? error.message : String(error),
        target.token,
      ),
    )
  }
}

export function parseNotifyArgs(argv) {
  const options = {
    caption: null,
    captionFile: null,
    dryRun: false,
    file: null,
    help: false,
    text: null,
    textFile: null,
    to: null,
  }
  const valueFlags = {
    '--caption': 'caption',
    '--caption-file': 'captionFile',
    '--file': 'file',
    '--text': 'text',
    '--text-file': 'textFile',
    '--to': 'to',
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    const separator = arg.indexOf('=')
    const flag = separator === -1 ? arg : arg.slice(0, separator)
    const key = valueFlags[flag]

    if (!key || separator === -1) {
      throw new Error(`[telegram] Unknown or incomplete option: ${arg}`)
    }

    options[key] = arg.slice(separator + 1)
  }

  if (options.help) {
    return options
  }

  if (!Object.hasOwn(TARGET_ENV, options.to ?? '')) {
    throw new Error('[telegram] Pass --to=personal or --to=group.')
  }

  if (options.text !== null && options.textFile !== null) {
    throw new Error('[telegram] Use either --text or --text-file, not both.')
  }

  if (options.caption !== null && options.captionFile !== null) {
    throw new Error(
      '[telegram] Use either --caption or --caption-file, not both.',
    )
  }

  if (options.text === null && options.textFile === null && !options.file) {
    throw new Error(
      '[telegram] Nothing to send: pass --text, --text-file or --file.',
    )
  }

  if (
    (options.caption !== null || options.captionFile !== null) &&
    !options.file
  ) {
    throw new Error('[telegram] --caption needs --file.')
  }

  return options
}

export function parseEnvFile(source) {
  const values = {}

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line === '' || line.startsWith('#')) {
      continue
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    )

    if (!match) {
      continue
    }

    let value = match[2].trim()
    const quote = value[0]

    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '')
    }

    values[match[1]] = value
  }

  return values
}

export function resolveTelegramTarget({ env, fileEnv, to }) {
  const read = (name) => {
    const value = env[name] || fileEnv[name] || ''
    return value.trim()
  }
  const token = read('TELEGRAM_BOT_TOKEN')
  const chatVariable = TARGET_ENV[to]
  const chatId = read(chatVariable)
  const missing = [
    token ? null : 'TELEGRAM_BOT_TOKEN',
    chatId ? null : chatVariable,
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(
      [
        `[telegram] Missing ${missing.join(', ')}.`,
        `[telegram] Set them in the environment or in ${DEFAULT_ENV_FILE} (git-ignored).`,
      ].join('\n'),
    )
  }

  return { chatId, token }
}

export function createDeliveryPlan({ caption, document, text }) {
  const plan = []

  if (text !== null) {
    if (text.trim() === '') {
      throw new Error('[telegram] Message text is empty.')
    }

    if (text.length > TELEGRAM_LIMITS.messageChars) {
      throw new Error(
        `[telegram] Message is ${text.length} characters; Telegram allows ${TELEGRAM_LIMITS.messageChars}.`,
      )
    }

    plan.push({ kind: 'message', text })
  }

  if (document) {
    if (document.size > TELEGRAM_LIMITS.documentBytes) {
      throw new Error(
        `[telegram] ${document.name} is ${formatBytes(document.size)}; bots can send up to ${formatBytes(TELEGRAM_LIMITS.documentBytes)}.`,
      )
    }

    if (caption !== null && caption.length > TELEGRAM_LIMITS.captionChars) {
      throw new Error(
        `[telegram] Caption is ${caption.length} characters; Telegram allows ${TELEGRAM_LIMITS.captionChars}.`,
      )
    }

    plan.push({ caption, document, kind: 'document' })
  }

  return plan
}

export function redactSecret(message, secret) {
  return secret ? message.split(secret).join('<redacted>') : message
}

async function sendStep(step, target) {
  if (step.kind === 'message') {
    await callTelegram(target.token, 'sendMessage', {
      body: JSON.stringify({ chat_id: target.chatId, text: step.text }),
      headers: { 'content-type': 'application/json' },
    })
    return
  }

  const form = new FormData()
  form.append('chat_id', target.chatId)
  form.append(
    'document',
    await openAsBlob(step.document.path),
    step.document.name,
  )

  if (step.caption) {
    form.append('caption', step.caption)
  }

  await callTelegram(target.token, 'sendDocument', { body: form })
}

async function callTelegram(token, method, init) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      ...init,
    },
  )
  const payload = await response.json().catch(() => null)

  if (!response.ok || payload?.ok !== true) {
    throw new Error(
      `[telegram] ${method} failed (HTTP ${response.status}): ${payload?.description ?? 'no description'}`,
    )
  }
}

async function readEnvFile(filePath) {
  try {
    return parseEnvFile(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

async function readOptionalText(inline, filePath) {
  if (inline !== null) {
    return inline
  }

  if (filePath !== null) {
    return (await readFile(filePath, 'utf8')).trimEnd()
  }

  return null
}

async function describeDocument(filePath) {
  const info = await stat(filePath).catch(() => null)

  if (!info?.isFile()) {
    throw new Error(`[telegram] File not found: ${filePath}`)
  }

  return { name: path.basename(filePath), path: filePath, size: info.size }
}

function describeStep(step) {
  return step.kind === 'message'
    ? `message (${step.text.length} chars)`
    : `${step.document.name} (${formatBytes(step.document.size)})`
}

function printDryRun(plan, to) {
  console.log(`[telegram] Dry run, target: ${to}. Nothing is sent.`)

  for (const step of plan) {
    console.log(`[telegram] Would send ${describeStep(step)}.`)

    if (step.kind === 'message') {
      console.log(step.text)
    } else if (step.caption) {
      console.log(`caption: ${step.caption}`)
    }
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function printHelp() {
  console.log(`
Usage:
  npm run notify:telegram -- --to=personal|group [options]

Sends a plain-text message and/or a document (APK) through the Telegram bot.
The text goes first, then the document with its caption.

Options:
  --to=personal|group   personal uses TELEGRAM_CHAT_ID, group TELEGRAM_GROUP_CHAT_ID
  --text=...            message text (up to 4096 characters)
  --text-file=path      read the message text from a file
  --file=path           document to send, for example the APK (up to 50 MB)
  --caption=...         document caption (up to 1024 characters)
  --caption-file=path   read the caption from a file
  --dry-run             validate and print what would be sent, send nothing

Credentials:
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_GROUP_CHAT_ID come from the
  environment or from .env.telegram.local (override with TELEGRAM_ENV_FILE).
  The token is never printed.
`)
}
