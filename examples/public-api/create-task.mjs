import { randomBytes } from 'node:crypto'

function uuidV7() {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  bytes[6] = (bytes[6] & 15) | 112
  bytes[8] = (bytes[8] & 63) | 128
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const secret = process.env.HAOTIKA_API_KEY
if (!secret) throw new Error('Set HAOTIKA_API_KEY in your environment.')
const base = (
  process.env.HAOTIKA_API_BASE_URL ?? 'https://chaotika.ru/api/public/v1'
).replace(/\/$/, '')
const id = process.env.HAOTIKA_OPERATION_ID ?? uuidV7()
console.log('Operation ID (save and reuse for retries):', id)
const response = await fetch(`${base}/tasks`, {
  method: 'POST',
  signal: AbortSignal.timeout(20_000),
  headers: {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    id,
    title: process.argv[2] ?? 'Оплатить интернет',
    note: 'Создано через API',
  }),
})
if (!response.ok)
  throw new Error(`HTTP ${response.status}: ${await response.text()}`)
console.log(await response.json())
