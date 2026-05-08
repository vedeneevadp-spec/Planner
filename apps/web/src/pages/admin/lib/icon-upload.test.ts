import { describe, expect, it } from 'vitest'

import {
  ACCEPTED_ICON_TYPES,
  createLabelFromFile,
  getSupportedIconMimeType,
  MAX_CONVERTIBLE_ICON_SOURCE_BYTES,
  MAX_ICON_ASSET_BYTES,
  prepareIconUpload,
  validateIconFile,
} from './icon-upload'

function createFile(
  name: string,
  options: {
    size?: number
    type?: string
  } = {},
): File {
  return new File([new Uint8Array(options.size ?? 4)], name, {
    type: options.type ?? '',
  })
}

describe('iconUpload', () => {
  it('accepts direct images and convertible sticker formats', () => {
    expect(ACCEPTED_ICON_TYPES).toContain('image/webp')
    expect(ACCEPTED_ICON_TYPES).toContain('video/webm')
    expect(ACCEPTED_ICON_TYPES).toContain('.tgs')
    expect(ACCEPTED_ICON_TYPES).toContain('.webm')
  })

  it('detects supported formats from MIME type or extension fallback', () => {
    expect(getSupportedIconMimeType(createFile('sticker.webp'))).toBe(
      'image/webp',
    )
    expect(getSupportedIconMimeType(createFile('sticker.webm'))).toBe(
      'video/webm',
    )
    expect(getSupportedIconMimeType(createFile('AnimatedSticker.tgs'))).toBe(
      'application/x-tgsticker',
    )
    expect(
      getSupportedIconMimeType(
        createFile('unknown-name', { type: 'image/png' }),
      ),
    ).toBe('image/png')
    expect(getSupportedIconMimeType(createFile('archive.zip'))).toBeNull()
  })

  it('uses a larger source limit for formats converted before upload', () => {
    expect(
      validateIconFile(
        createFile('too-big.png', {
          size: MAX_ICON_ASSET_BYTES + 1,
          type: 'image/png',
        }),
      ),
    ).toBe('Файл должен быть не больше 1 MB.')

    expect(
      validateIconFile(
        createFile('source.webm', {
          size: MAX_ICON_ASSET_BYTES + 1,
          type: 'video/webm',
        }),
      ),
    ).toBeNull()

    expect(
      validateIconFile(
        createFile('too-big.tgs', {
          size: MAX_CONVERTIBLE_ICON_SOURCE_BYTES + 1,
        }),
      ),
    ).toBe('Файл должен быть не больше 5 MB.')
  })

  it('normalizes direct image data URL MIME type before upload', async () => {
    const upload = await prepareIconUpload(createFile('icon.png'))

    expect(upload).toEqual({
      value: 'data:image/png;base64,AAAAAA==',
      wasConverted: false,
    })
  })

  it('creates labels from file names', () => {
    expect(createLabelFromFile(createFile('миска.webp'))).toBe('миска')
    expect(createLabelFromFile(createFile('focus_marker-icon.tgs'))).toBe(
      'focus marker icon',
    )
  })

  it('rejects unsupported files', () => {
    expect(validateIconFile(createFile('notes.txt'))).toBe(
      'Поддерживаются только PNG, WebP, JPG, GIF, WebM и TGS.',
    )
  })
})
