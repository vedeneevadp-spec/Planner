import { describe, expect, it } from 'vitest'

import {
  ACCEPTED_PROFILE_AVATAR_TYPES,
  MAX_PROFILE_AVATAR_BYTES,
  prepareProfileAvatarUpload,
  validateProfileAvatarFile,
} from './profile-avatar-upload'

describe('profile avatar upload helpers', () => {
  it('accepts supported image MIME types and extension fallbacks', () => {
    expect(
      validateProfileAvatarFile(
        new File(['avatar'], 'avatar.png', { type: 'image/png' }),
      ),
    ).toBeNull()
    expect(
      validateProfileAvatarFile(new File(['avatar'], 'avatar.jpg')),
    ).toBeNull()
    expect(ACCEPTED_PROFILE_AVATAR_TYPES).toContain('.webp')
  })

  it('rejects unsupported and oversized avatar files', () => {
    expect(
      validateProfileAvatarFile(
        new File(['plain text'], 'avatar.txt', { type: 'text/plain' }),
      ),
    ).toBe('Поддерживаются PNG, WebP, JPG и GIF.')

    expect(
      validateProfileAvatarFile(
        new File([new Uint8Array(MAX_PROFILE_AVATAR_BYTES + 1)], 'avatar.png', {
          type: 'image/png',
        }),
      ),
    ).toBe('Файл должен быть не больше 2 MB.')
  })

  it('prepares a supported file as a normalized data URL', async () => {
    const dataUrl = await prepareProfileAvatarUpload(
      new File(['avatar'], 'avatar.jpg'),
    )

    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('throws when preparing an unsupported file', async () => {
    await expect(
      prepareProfileAvatarUpload(
        new File(['plain text'], 'avatar.txt', { type: 'text/plain' }),
      ),
    ).rejects.toThrow('Файл имеет неподдерживаемый формат.')
  })
})
