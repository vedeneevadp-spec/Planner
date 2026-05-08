import type { AnimationItem } from 'lottie-web'

export const MAX_ICON_ASSET_BYTES = 1024 * 1024
export const MAX_CONVERTIBLE_ICON_SOURCE_BYTES = 5 * 1024 * 1024

const TGS_MIME_TYPE = 'application/x-tgsticker'
const WEBM_MIME_TYPE = 'video/webm'
const PNG_MIME_TYPE = 'image/png'
const LOTTIE_RENDER_SIZE = 512

const DIRECT_ICON_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  PNG_MIME_TYPE,
  'image/webp',
])
const CONVERTIBLE_ICON_MIME_TYPES = new Set([WEBM_MIME_TYPE, TGS_MIME_TYPE])
const SUPPORTED_ICON_MIME_TYPES = new Set([
  ...DIRECT_ICON_MIME_TYPES,
  ...CONVERTIBLE_ICON_MIME_TYPES,
])
const SUPPORTED_ICON_EXTENSIONS = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', PNG_MIME_TYPE],
  ['.tgs', TGS_MIME_TYPE],
  ['.webm', WEBM_MIME_TYPE],
  ['.webp', 'image/webp'],
])

export const ACCEPTED_ICON_TYPES = [
  ...SUPPORTED_ICON_MIME_TYPES,
  ...SUPPORTED_ICON_EXTENSIONS.keys(),
].join(',')

export interface PreparedIconUpload {
  value: string
  wasConverted: boolean
}

export function validateIconFile(file: File): string | null {
  const mimeType = getSupportedIconMimeType(file)

  if (!mimeType) {
    return 'Поддерживаются только PNG, WebP, JPG, GIF, WebM и TGS.'
  }

  const maxSize = getMaxSourceFileSize(mimeType)

  if (file.size > maxSize) {
    return `Файл должен быть не больше ${formatFileSize(maxSize)}.`
  }

  return null
}

export async function prepareIconUpload(
  file: File,
): Promise<PreparedIconUpload> {
  const mimeType = getSupportedIconMimeType(file)

  if (!mimeType) {
    throw new Error('Файл имеет неподдерживаемый формат.')
  }

  if (mimeType === WEBM_MIME_TYPE) {
    const value = await convertWebmToPngDataUrl(file)

    assertIconDataUrlFits(value, true)

    return { value, wasConverted: true }
  }

  if (mimeType === TGS_MIME_TYPE) {
    const value = await convertTgsToPngDataUrl(file)

    assertIconDataUrlFits(value, true)

    return { value, wasConverted: true }
  }

  const value = await readFileAsDataUrl(file, mimeType)

  assertIconDataUrlFits(value, false)

  return { value, wasConverted: false }
}

export function getSupportedIconMimeType(file: File): string | null {
  if (SUPPORTED_ICON_MIME_TYPES.has(file.type)) {
    return file.type
  }

  const normalizedFileName = file.name.toLowerCase()
  const extension = [...SUPPORTED_ICON_EXTENSIONS.keys()].find((candidate) =>
    normalizedFileName.endsWith(candidate),
  )

  return extension ? (SUPPORTED_ICON_EXTENSIONS.get(extension) ?? null) : null
}

export function createLabelFromFile(file: File): string {
  return file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }

  return `${Math.round(bytes / 1024)} KB`
}

function getMaxSourceFileSize(mimeType: string): number {
  return CONVERTIBLE_ICON_MIME_TYPES.has(mimeType)
    ? MAX_CONVERTIBLE_ICON_SOURCE_BYTES
    : MAX_ICON_ASSET_BYTES
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

function convertWebmToPngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')

    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = objectUrl

    const cleanup = () => {
      video.removeEventListener('loadeddata', convert)
      video.removeEventListener('error', fail)
      URL.revokeObjectURL(objectUrl)
      video.removeAttribute('src')
      video.load()
    }

    const fail = () => {
      cleanup()
      reject(new Error('Не удалось открыть WebM для конвертации.'))
    }

    const convert = () => {
      const width = video.videoWidth
      const height = video.videoHeight

      if (!width || !height) {
        fail()
        return
      }

      const canvas = document.createElement('canvas')

      canvas.width = width
      canvas.height = height

      const context = canvas.getContext('2d')

      if (!context) {
        cleanup()
        reject(new Error('Браузер не поддерживает canvas-конвертацию.'))
        return
      }

      context.drawImage(video, 0, 0, width, height)

      const value = canvas.toDataURL(PNG_MIME_TYPE)

      cleanup()
      resolve(value)
    }

    video.addEventListener('loadeddata', convert, { once: true })
    video.addEventListener('error', fail, { once: true })
    video.load()
  })
}

async function convertTgsToPngDataUrl(file: File): Promise<string> {
  const animationData = await readTgsAnimationData(file)

  return renderLottieFirstFrameToPng(animationData)
}

async function readTgsAnimationData(file: File): Promise<unknown> {
  const buffer = await file.arrayBuffer()
  const text = await readGzipText(buffer)

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('TGS-файл не содержит корректную Lottie-анимацию.')
  }
}

async function readGzipText(buffer: ArrayBuffer): Promise<string> {
  if (!isGzipBuffer(buffer)) {
    return new TextDecoder().decode(buffer)
  }

  if (!('DecompressionStream' in globalThis)) {
    throw new Error(
      'Этот браузер не умеет распаковывать TGS. Загрузите WebP/PNG или обновите браузер.',
    )
  }

  try {
    const stream = new Blob([buffer])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))

    return await new Response(stream).text()
  } catch {
    throw new Error('Не удалось распаковать TGS-файл.')
  }
}

function isGzipBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)

  return bytes[0] === 0x1f && bytes[1] === 0x8b
}

async function renderLottieFirstFrameToPng(
  animationData: unknown,
): Promise<string> {
  const { default: lottie } =
    await import('lottie-web/build/player/lottie_light_canvas')
  const container = document.createElement('div')
  let animation: AnimationItem | null = null

  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = `${LOTTIE_RENDER_SIZE}px`
  container.style.height = `${LOTTIE_RENDER_SIZE}px`
  container.style.pointerEvents = 'none'
  container.style.opacity = '0'

  document.body.append(container)

  try {
    animation = lottie.loadAnimation({
      animationData,
      autoplay: false,
      container,
      loop: false,
      renderer: 'canvas',
      rendererSettings: {
        clearCanvas: true,
        preserveAspectRatio: 'xMidYMid meet',
      },
    })

    await waitForLottieLoad(animation)
    animation.goToAndStop(0, true)
    await waitForAnimationFrame()

    const canvas = container.querySelector('canvas')

    if (!canvas) {
      throw new Error('Не удалось отрисовать TGS в PNG.')
    }

    return canvas.toDataURL(PNG_MIME_TYPE)
  } finally {
    animation?.destroy()
    container.remove()
  }
}

function waitForLottieLoad(animation: AnimationItem): Promise<void> {
  return new Promise((resolve, reject) => {
    if (animation.isLoaded) {
      resolve()
      return
    }

    const disposers: Array<() => void> = []
    const cleanup = () => {
      for (const dispose of disposers) {
        dispose()
      }
    }
    const handleLoaded = () => {
      cleanup()
      resolve()
    }
    const handleFailed = () => {
      cleanup()
      reject(new Error('Не удалось загрузить Lottie-анимацию из TGS.'))
    }

    disposers.push(
      animation.addEventListener('DOMLoaded', handleLoaded),
      animation.addEventListener('data_failed', handleFailed),
      animation.addEventListener('error', handleFailed),
    )
  })
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function assertIconDataUrlFits(dataUrl: string, wasConverted: boolean): void {
  const byteLength = getBase64DataUrlByteLength(dataUrl)

  if (byteLength === null || byteLength === 0) {
    throw new Error('Не удалось подготовить файл к загрузке.')
  }

  if (byteLength > MAX_ICON_ASSET_BYTES) {
    throw new Error(
      wasConverted
        ? `После конвертации иконка должна быть не больше ${formatFileSize(
            MAX_ICON_ASSET_BYTES,
          )}.`
        : `Файл должен быть не больше ${formatFileSize(MAX_ICON_ASSET_BYTES)}.`,
    )
  }
}

function getBase64DataUrlByteLength(dataUrl: string): number | null {
  const match = /^data:[^,]+;base64,([a-z0-9+/=\s]+)$/iu.exec(dataUrl)

  if (!match?.[1]) {
    return null
  }

  const base64Payload = match[1].replace(/\s/g, '')
  const padding = base64Payload.endsWith('==')
    ? 2
    : base64Payload.endsWith('=')
      ? 1
      : 0

  return Math.floor((base64Payload.length * 3) / 4) - padding
}
