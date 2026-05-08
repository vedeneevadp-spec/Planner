import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MAX_ICON_ASSET_BYTES = 1024 * 1024

const ICON_DATA_URL_PATTERN =
  /^data:(image\/(?:gif|jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/iu

const ICON_EXTENSIONS_BY_MIME_TYPE = new Map<string, string>([
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export interface ParsedUploadedIcon {
  buffer: Buffer
  extension: string
  mimeType: string
}

export interface StoreIconAssetInput {
  dataUrl: string
  iconAssetId: string
  iconSetId: string
  sortOrder: number
  workspaceId: string
}

export interface IconAssetStorage {
  deleteIconAsset(value: string): Promise<void>
  storeIconAsset(input: StoreIconAssetInput): Promise<string>
}

export class LocalIconAssetStorage implements IconAssetStorage {
  private readonly rootDirectory: string

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory)
  }

  async storeIconAsset(input: StoreIconAssetInput): Promise<string> {
    const parsedIcon = parseUploadedIconDataUrl(input.dataUrl)

    if (!parsedIcon) {
      throw new Error('Invalid uploaded icon data URL.')
    }

    const fileName = buildIconAssetFileName(input, parsedIcon.extension)
    const filePath = path.join(this.rootDirectory, fileName)

    await mkdir(this.rootDirectory, { recursive: true })
    await writeFile(filePath, parsedIcon.buffer)

    return `/api/v1/icon-assets/${fileName}`
  }

  async deleteIconAsset(value: string): Promise<void> {
    const fileName = extractLocalIconAssetFileName(value)

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

export function parseUploadedIconDataUrl(
  value: string,
): ParsedUploadedIcon | null {
  const match = ICON_DATA_URL_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const [, mimeType, base64Payload] = match
  const extension = mimeType
    ? ICON_EXTENSIONS_BY_MIME_TYPE.get(mimeType.toLowerCase())
    : undefined

  if (!mimeType || !extension || !base64Payload) {
    return null
  }

  const buffer = Buffer.from(base64Payload.replace(/\s/g, ''), 'base64')

  if (buffer.byteLength === 0 || buffer.byteLength > MAX_ICON_ASSET_BYTES) {
    return null
  }

  return {
    buffer,
    extension,
    mimeType,
  }
}

function buildIconAssetFileName(
  input: StoreIconAssetInput,
  extension: string,
): string {
  return `${sanitizeFileNamePart(input.iconAssetId)}.${extension}`
}

function sanitizeFileNamePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'asset'
  )
}

function extractLocalIconAssetFileName(value: string): string | null {
  const normalizedValue = value.trim()
  const pathPrefix = '/api/v1/icon-assets/'
  const pathIndex = normalizedValue.indexOf(pathPrefix)

  if (pathIndex === -1) {
    return null
  }

  const fileName = normalizedValue.slice(pathIndex + pathPrefix.length)

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
