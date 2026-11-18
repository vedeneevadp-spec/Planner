import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createDeliveryPlan,
  parseEnvFile,
  parseNotifyArgs,
  redactSecret,
  resolveTelegramTarget,
  TELEGRAM_LIMITS,
} from './notify-telegram.mjs'

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'notify-telegram.mjs',
)

test('parses targets, payload options and rejects ambiguous input', () => {
  assert.deepEqual(
    parseNotifyArgs([
      '--to=personal',
      '--text=Готово',
      '--file=app.apk',
      '--caption=Новая версия',
      '--dry-run',
    ]),
    {
      caption: 'Новая версия',
      captionFile: null,
      dryRun: true,
      file: 'app.apk',
      help: false,
      text: 'Готово',
      textFile: null,
      to: 'personal',
    },
  )
  assert.equal(parseNotifyArgs(['--to=group', '--text=a=b']).text, 'a=b')
  assert.equal(parseNotifyArgs(['--help']).help, true)

  assert.throws(() => parseNotifyArgs(['--text=x']), /--to=personal/)
  assert.throws(() => parseNotifyArgs(['--to=everyone', '--text=x']), /--to/)
  assert.throws(() => parseNotifyArgs(['--to=group']), /Nothing to send/)
  assert.throws(
    () => parseNotifyArgs(['--to=group', '--text=x', '--text-file=y']),
    /either --text/,
  )
  assert.throws(
    () => parseNotifyArgs(['--to=group', '--text=x', '--caption=y']),
    /--caption needs --file/,
  )
  assert.throws(() => parseNotifyArgs(['--to=group', '--file']), /incomplete/)
  assert.throws(() => parseNotifyArgs(['--to=group', '--oops=1']), /Unknown/)
})

test('reads the git-ignored env file format', () => {
  assert.deepEqual(
    parseEnvFile(
      [
        '# comment',
        '',
        'TELEGRAM_BOT_TOKEN=123:abc',
        'export TELEGRAM_CHAT_ID="42"',
        "TELEGRAM_GROUP_CHAT_ID='-100500' ",
        'OTHER=value # trailing comment',
        'not a pair',
      ].join('\n'),
    ),
    {
      OTHER: 'value',
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_CHAT_ID: '42',
      TELEGRAM_GROUP_CHAT_ID: '-100500',
    },
  )
})

test('resolves the chat per target, preferring the process environment', () => {
  const fileEnv = {
    TELEGRAM_BOT_TOKEN: 'file-token',
    TELEGRAM_CHAT_ID: '1',
    TELEGRAM_GROUP_CHAT_ID: '-2',
  }

  assert.deepEqual(resolveTelegramTarget({ env: {}, fileEnv, to: 'group' }), {
    chatId: '-2',
    token: 'file-token',
  })
  assert.deepEqual(
    resolveTelegramTarget({
      env: { TELEGRAM_BOT_TOKEN: 'env-token' },
      fileEnv,
      to: 'personal',
    }),
    { chatId: '1', token: 'env-token' },
  )

  assert.throws(
    () =>
      resolveTelegramTarget({
        env: {},
        fileEnv: { TELEGRAM_BOT_TOKEN: 'secret-token' },
        to: 'group',
      }),
    (error) =>
      /Missing TELEGRAM_GROUP_CHAT_ID/.test(error.message) &&
      !error.message.includes('secret-token'),
  )
})

test('plans the text before the document and enforces Telegram limits', () => {
  const document = { name: 'app.apk', path: '/tmp/app.apk', size: 13 << 20 }

  assert.deepEqual(
    createDeliveryPlan({ caption: 'Обновление', document, text: 'Сводка' }).map(
      (step) => step.kind,
    ),
    ['message', 'document'],
  )
  assert.deepEqual(
    createDeliveryPlan({ caption: null, document: null, text: 'Только текст' }),
    [{ kind: 'message', text: 'Только текст' }],
  )

  assert.throws(
    () => createDeliveryPlan({ caption: null, document: null, text: '  ' }),
    /empty/,
  )
  assert.throws(
    () =>
      createDeliveryPlan({
        caption: null,
        document: null,
        text: 'x'.repeat(TELEGRAM_LIMITS.messageChars + 1),
      }),
    /4096/,
  )
  assert.throws(
    () =>
      createDeliveryPlan({
        caption: 'x'.repeat(TELEGRAM_LIMITS.captionChars + 1),
        document,
        text: null,
      }),
    /1024/,
  )
  assert.throws(
    () =>
      createDeliveryPlan({
        caption: null,
        document: { ...document, size: TELEGRAM_LIMITS.documentBytes + 1 },
        text: null,
      }),
    /up to 50\.0 MB/,
  )
})

test('never leaks the bot token in error text', () => {
  assert.equal(
    redactSecret(
      'POST https://api.telegram.org/bot123:abc/sendMessage',
      '123:abc',
    ),
    'POST https://api.telegram.org/bot<redacted>/sendMessage',
  )
  assert.equal(redactSecret('plain', ''), 'plain')
})

test('dry run validates everything without sending or printing the token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notify-telegram-'))

  try {
    const envFile = join(directory, 'telegram.env')
    const apk = join(directory, 'app-release.apk')

    await writeFile(
      envFile,
      'TELEGRAM_BOT_TOKEN=999:dry-run-secret\nTELEGRAM_CHAT_ID=7\n',
    )
    await writeFile(apk, 'apk')

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--to=personal',
        '--text=Релиз готов',
        `--file=${apk}`,
        '--caption=APK',
        '--dry-run',
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          TELEGRAM_ENV_FILE: envFile,
        },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Dry run, target: personal/)
    assert.match(result.stdout, /Would send message/)
    assert.match(result.stdout, /Would send app-release\.apk/)
    assert.doesNotMatch(result.stdout + result.stderr, /dry-run-secret/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
