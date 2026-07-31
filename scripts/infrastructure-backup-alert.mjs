import os from 'node:os'
import { pathToFileURL } from 'node:url'

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

  const text = `Planner backup automation failed: ${failedUnit} on ${hostname} at ${occurredAt}.`
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

async function main() {
  const failedUnit = process.argv[2]?.trim() || 'unknown-backup-unit'
  const occurredAt = new Date().toISOString()
  const { payload, targetUrl } = buildBackupAlertRequest({
    env: process.env,
    failedUnit,
    hostname: os.hostname(),
    occurredAt,
  })
  const response = await fetch(targetUrl, {
    body: JSON.stringify(payload),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(
      `Backup alert delivery returned HTTP ${response.status} ${response.statusText}.`,
    )
  }

  console.log(`[backup] Failure alert delivered for ${failedUnit}.`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
