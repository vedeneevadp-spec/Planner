import { appIcons } from './app-icons'
import {
  getImageIconAssetId,
  getSvgIconName,
  isAppIconName,
  type UploadedIconAsset,
} from './icon-value'
import styles from './IconValue.module.css'

interface IconMarkProps {
  className?: string | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  value: string
}

export function IconMark({
  className,
  uploadedIcons = [],
  value,
}: IconMarkProps) {
  const rootClassName = className ? `${styles.mark} ${className}` : styles.mark
  const imageAssetId = getImageIconAssetId(value)

  if (imageAssetId) {
    const uploadedIcon = uploadedIcons.find((icon) => icon.id === imageAssetId)

    return (
      <span className={rootClassName}>
        {uploadedIcon ? (
          <img
            className={styles.image}
            src={uploadedIcon.value}
            alt=""
            aria-hidden="true"
          />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            ?
          </span>
        )}
      </span>
    )
  }

  const svgIconName = getSvgIconName(value)

  if (isAppIconName(svgIconName)) {
    const SvgIcon = appIcons[svgIconName]

    return (
      <span className={rootClassName}>
        <SvgIcon size={18} />
      </span>
    )
  }

  const fallbackIcon = getFallbackIcon(value)

  return (
    <span className={rootClassName}>
      <span
        className={
          fallbackIcon.isCompact
            ? `${styles.text} ${styles.textCompact}`
            : styles.text
        }
        aria-hidden="true"
      >
        {fallbackIcon.value}
      </span>
    </span>
  )
}

function getFallbackIcon(value: string): { isCompact: boolean; value: string } {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return { isCompact: false, value: '•' }
  }

  if (!/[0-9A-Za-z]/.test(trimmedValue)) {
    return { isCompact: false, value: trimmedValue }
  }

  const parts = trimmedValue.split(/[^0-9A-Za-z]+/).filter(Boolean)

  if (parts.length > 1) {
    return {
      isCompact: true,
      value: parts
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toUpperCase(),
    }
  }

  const compactValue = Array.from(trimmedValue).slice(0, 2).join('')

  return {
    isCompact: compactValue.length < trimmedValue.length,
    value: compactValue.toUpperCase(),
  }
}
