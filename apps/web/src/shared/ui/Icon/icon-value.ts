import { appIcons } from './app-icons'

export interface UploadedIconAsset {
  id: string
  label: string
  value: string
}

export type AppIconName = keyof typeof appIcons

export const emojiIconChoices = ['📁', '🎯', '💼', '📚', '🧭', '✦'] as const
export const svgIconChoices = Object.keys(appIcons) as AppIconName[]

const SVG_ICON_PREFIX = 'svg:'
const IMAGE_ICON_PREFIX = 'image:'

export function createSvgIconValue(name: AppIconName): string {
  return `${SVG_ICON_PREFIX}${name}`
}

export function createImageIconValue(assetId: string): string {
  return `${IMAGE_ICON_PREFIX}${assetId}`
}

export function isImageIconValue(value: string): boolean {
  return value.startsWith(IMAGE_ICON_PREFIX)
}

export function getImageIconAssetId(value: string): string | null {
  return isImageIconValue(value) ? value.slice(IMAGE_ICON_PREFIX.length) : null
}

export function isSvgIconValue(value: string): boolean {
  return value.startsWith(SVG_ICON_PREFIX)
}

export function getSvgIconName(value: string): string {
  return isSvgIconValue(value) ? value.slice(SVG_ICON_PREFIX.length) : value
}

export function isAppIconName(value: string): value is AppIconName {
  return value in appIcons
}

export function getIconLabel(
  value: string,
  uploadedIcons: UploadedIconAsset[] = [],
): string {
  const imageAssetId = getImageIconAssetId(value)

  if (imageAssetId) {
    return (
      uploadedIcons.find((icon) => icon.id === imageAssetId)?.label ??
      'Загруженная иконка'
    )
  }

  if (isSvgIconValue(value)) {
    return getSvgIconName(value)
  }

  if (isAppIconName(value)) {
    return value
  }

  return value || 'Без иконки'
}
