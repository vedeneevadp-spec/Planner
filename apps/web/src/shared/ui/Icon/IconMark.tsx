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

  return (
    <span className={rootClassName}>
      <span className={styles.text} aria-hidden="true">
        {value || '•'}
      </span>
    </span>
  )
}
