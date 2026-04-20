import { z } from 'zod'

const uuidV7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface WebCryptoLike {
  getRandomValues: (array: Uint8Array) => Uint8Array
}

export const uuidV7Schema = z.string().regex(uuidV7Pattern, {
  message: 'Expected a UUIDv7 identifier.',
})

export function generateUuidV7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  const cryptoApi = (
    globalThis as typeof globalThis & { crypto?: WebCryptoLike }
  ).crypto

  if (!cryptoApi) {
    throw new Error('crypto.getRandomValues is not available in this runtime.')
  }

  cryptoApi.getRandomValues(bytes)

  const timestamp = BigInt(timestampMs)

  bytes[0] = Number((timestamp >> 40n) & 0xffn)
  bytes[1] = Number((timestamp >> 32n) & 0xffn)
  bytes[2] = Number((timestamp >> 24n) & 0xffn)
  bytes[3] = Number((timestamp >> 16n) & 0xffn)
  bytes[4] = Number((timestamp >> 8n) & 0xffn)
  bytes[5] = Number(timestamp & 0xffn)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

export function isUuidV7(value: string): boolean {
  return uuidV7Pattern.test(value)
}
