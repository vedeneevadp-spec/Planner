export const MAX_PROFILE_AVATAR_BYTES = 2 * 1024 * 1024

const SUPPORTED_PROFILE_AVATAR_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

const SUPPORTED_PROFILE_AVATAR_EXTENSIONS = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

export const ACCEPTED_PROFILE_AVATAR_TYPES = [
  ...SUPPORTED_PROFILE_AVATAR_MIME_TYPES,
  ...SUPPORTED_PROFILE_AVATAR_EXTENSIONS.keys(),
].join(',')

export function validateProfileAvatarFile(file: File): string | null {
  if (!getSupportedProfileAvatarMimeType(file)) {
    return 'Поддерживаются PNG, WebP, JPG и GIF.'
  }

  if (file.size > MAX_PROFILE_AVATAR_BYTES) {
    return 'Файл должен быть не больше 2 MB.'
  }

  return null
}

export async function prepareProfileAvatarUpload(file: File): Promise<string> {
  const mimeType = getSupportedProfileAvatarMimeType(file)

  if (!mimeType) {
    throw new Error('Файл имеет неподдерживаемый формат.')
  }

  return readFileAsDataUrl(file, mimeType)
}

function getSupportedProfileAvatarMimeType(file: File): string | null {
  if (SUPPORTED_PROFILE_AVATAR_MIME_TYPES.has(file.type)) {
    return file.type
  }

  const normalizedFileName = file.name.toLowerCase()
  const extension = [...SUPPORTED_PROFILE_AVATAR_EXTENSIONS.keys()].find(
    (candidate) => normalizedFileName.endsWith(candidate),
  )

  return extension
    ? (SUPPORTED_PROFILE_AVATAR_EXTENSIONS.get(extension) ?? null)
    : null
}

function readFileAsDataUrl(
  file: File,
  fallbackMimeType: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Файл прочитан в неподдерживаемом формате.'))
        return
      }

      const base64Marker = ';base64,'
      const base64MarkerIndex = reader.result.indexOf(base64Marker)

      if (base64MarkerIndex !== -1) {
        resolve(
          `data:${fallbackMimeType};base64,${reader.result.slice(
            base64MarkerIndex + base64Marker.length,
          )}`,
        )
        return
      }

      resolve(reader.result)
    }

    reader.readAsDataURL(file)
  })
}
