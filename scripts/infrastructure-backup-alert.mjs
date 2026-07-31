import os from 'node:os'
import { pathToFileURL } from 'node:url'

import nodemailer from 'nodemailer'

export function buildBackupAlertRequest({
  env,
  failedUnit,
  hostname,
  occurredAt,
}) {
  const webhookUrl = env.BACKUP_ALERT_WEBHOOK_URL?.trim()
  const telegramBotToken = env.BACKUP_ALERT_TELEGRAM_BOT_TOKEN?.trim()
  const telegramChatId = env.BACKUP_ALERT_TELEGRAM_CHAT_ID?.trim()

  if (!webhookUrl && (!telegramBotToken || !telegramChatId)) {
    throw new Error(
      'BACKUP_ALERT_WEBHOOK_URL or Telegram backup alert credentials are required.',
    )
  }

  const text = buildBackupAlertText({ failedUnit, hostname, occurredAt })
  const webhookPayload = {
    event: 'planner_backup_automation_failed',
    host: hostname,
    occurredAt,
    service: failedUnit,
    text,
  }
  const targetUrl =
    webhookUrl ?? `https://api.telegram.org/bot${telegramBotToken}/sendMessage`
  const payload = webhookUrl
    ? webhookPayload
    : {
        chat_id: telegramChatId,
        disable_web_page_preview: true,
        text,
      }

  return { payload, targetUrl }
}

export function buildBackupAlertEmail({
  env,
  failedUnit,
  hostname,
  occurredAt,
}) {
  const from = env.AUTH_EMAIL_FROM?.trim()
  const host = env.AUTH_SMTP_HOST?.trim()
  const password = env.AUTH_SMTP_PASSWORD
  const port = Number(env.AUTH_SMTP_PORT)
  const secure = env.AUTH_SMTP_SECURE?.trim().toLowerCase() === 'true'
  const to = env.BACKUP_ALERT_EMAIL_TO?.trim()
  const user = env.AUTH_SMTP_USER?.trim()

  if (!from || !host || !to || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      'BACKUP_ALERT_EMAIL_TO and complete AUTH_SMTP_* settings are required for email alerts.',
    )
  }

  if (Boolean(user) !== Boolean(password)) {
    throw new Error(
      'AUTH_SMTP_USER and AUTH_SMTP_PASSWORD must be configured together.',
    )
  }

  const text = buildBackupAlertText({ failedUnit, hostname, occurredAt })

  return {
    message: {
      from,
      subject: `[Chaotika] Backup automation failure on ${hostname}`,
      text,
      to,
    },
    transport: {
      auth: user
        ? {
            pass: password,
            user,
          }
        : undefined,
      host,
      port,
      secure,
    },
  }
}

async function main() {
  const failedUnit = process.argv[2]?.trim() || 'unknown-backup-unit'
  const occurredAt = new Date().toISOString()
  const hostname = os.hostname()
  let httpDeliveryError

  if (hasHttpAlertConfiguration(process.env)) {
    try {
      await deliverHttpAlert({
        env: process.env,
        failedUnit,
        hostname,
        occurredAt,
      })
      console.log(`[backup] Failure alert delivered for ${failedUnit}.`)
      return
    } catch (error) {
      httpDeliveryError = error
      console.warn(
        `[backup] HTTP alert delivery failed; trying email fallback: ${getErrorMessage(error)}`,
      )
    }
  }

  if (process.env.BACKUP_ALERT_EMAIL_TO?.trim()) {
    await deliverEmailAlert({
      env: process.env,
      failedUnit,
      hostname,
      occurredAt,
    })
    console.log(`[backup] Failure alert delivered via email for ${failedUnit}.`)
    return
  }

  if (httpDeliveryError) {
    throw new Error(
      `Backup alert delivery failed: ${getErrorMessage(httpDeliveryError)}`,
    )
  }

  throw new Error(
    'Configure a backup alert webhook, Telegram credentials, or BACKUP_ALERT_EMAIL_TO.',
  )
}

function buildBackupAlertText({ failedUnit, hostname, occurredAt }) {
  return `Planner backup automation failed: ${failedUnit} on ${hostname} at ${occurredAt}.`
}

async function deliverHttpAlert(context) {
  const { payload, targetUrl } = buildBackupAlertRequest(context)
  const response = await fetch(targetUrl, {
    body: JSON.stringify(payload),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
  })

  if (!response.ok) {
    throw new Error(
      `Backup alert delivery returned HTTP ${response.status} ${response.statusText}.`,
    )
  }
}

async function deliverEmailAlert(context) {
  const { message, transport } = buildBackupAlertEmail(context)
  const transporter = nodemailer.createTransport(transport)

  try {
    await transporter.sendMail(message)
  } finally {
    transporter.close()
  }
}

function hasHttpAlertConfiguration(env) {
  return Boolean(
    env.BACKUP_ALERT_WEBHOOK_URL?.trim() ||
    env.BACKUP_ALERT_TELEGRAM_BOT_TOKEN?.trim() ||
    env.BACKUP_ALERT_TELEGRAM_CHAT_ID?.trim(),
  )
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
