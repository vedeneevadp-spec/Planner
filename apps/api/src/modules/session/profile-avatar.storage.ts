import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MAX_PROFILE_AVATAR_BYTES = 2 * 1024 * 1024
export const PROFILE_AVATAR_PUBLIC_PATH_PREFIX = '/api/v1/profile-assets/'

const PROFILE_AVATAR_DATA_URL_PATTERN =
  /^data:(image\/(?:gif|jpeg|png|svg\+xml|webp));base64,([a-z0-9+/=\s]+)$/iu

const PROFILE_AVATAR_EXTENSIONS_BY_MIME_TYPE = new Map<string, string>([
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/svg+xml', 'svg'],
  ['image/webp', 'webp'],
])

export interface ParsedUploadedProfileAvatar {
  buffer: Buffer
  extension: string
  mimeType: string
}

export interface StoreProfileAvatarInput {
  dataUrl: string
  userId: string
}

export interface ProfileAvatarStorage {
  deleteProfileAvatar(value: string): Promise<void>
  storeProfileAvatar(input: StoreProfileAvatarInput): Promise<string>
}

export class LocalProfileAvatarStorage implements ProfileAvatarStorage {
  private readonly rootDirectory: string

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory)
  }

  async storeProfileAvatar(input: StoreProfileAvatarInput): Promise<string> {
    const parsedAvatar = parseUploadedProfileAvatarDataUrl(input.dataUrl)

    if (!parsedAvatar) {
      throw new Error('Invalid uploaded profile avatar data URL.')
    }

    const fileName = buildProfileAvatarFileName(input, parsedAvatar.extension)
    const filePath = path.join(this.rootDirectory, fileName)

    await mkdir(this.rootDirectory, { recursive: true })
    await writeFile(filePath, parsedAvatar.buffer)

    return `${PROFILE_AVATAR_PUBLIC_PATH_PREFIX}${fileName}`
  }

  async deleteProfileAvatar(value: string): Promise<void> {
    const fileName = extractLocalProfileAvatarFileName(value)

    if (!fileName) {
      return
    }

    try {
      await unlink(path.join(this.rootDirectory, fileName))
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return
      }

      throw error
    }
  }
}

export class NoopProfileAvatarStorage implements ProfileAvatarStorage {
  deleteProfileAvatar(): Promise<void> {
    return Promise.resolve()
  }

  storeProfileAvatar(input: StoreProfileAvatarInput): Promise<string> {
    return Promise.resolve(input.dataUrl)
  }
}

export function parseUploadedProfileAvatarDataUrl(
  value: string,
): ParsedUploadedProfileAvatar | null {
  const match = PROFILE_AVATAR_DATA_URL_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const [, mimeType, base64Payload] = match
  const extension = mimeType
    ? PROFILE_AVATAR_EXTENSIONS_BY_MIME_TYPE.get(mimeType.toLowerCase())
    : undefined

  if (!mimeType || !extension || !base64Payload) {
    return null
  }

  const buffer = Buffer.from(base64Payload.replace(/\s/g, ''), 'base64')

  if (
    buffer.byteLength === 0 ||
    buffer.byteLength > MAX_PROFILE_AVATAR_BYTES
  ) {
    return null
  }

  return {
    buffer,
    extension,
    mimeType,
  }
}

function buildProfileAvatarFileName(
  input: StoreProfileAvatarInput,
  extension: string,
): string {
  return `${sanitizeFileNamePart(input.userId)}-${Date.now()}.${extension}`
}

function sanitizeFileNamePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'user'
  )
}

function extractLocalProfileAvatarFileName(value: string): string | null {
  const normalizedValue = value.trim()
  const pathIndex = normalizedValue.indexOf(PROFILE_AVATAR_PUBLIC_PATH_PREFIX)

  if (pathIndex === -1) {
    return null
  }

  const fileName = normalizedValue.slice(
    pathIndex + PROFILE_AVATAR_PUBLIC_PATH_PREFIX.length,
  )

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(fileName)) {
    return null
  }

  return fileName
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
