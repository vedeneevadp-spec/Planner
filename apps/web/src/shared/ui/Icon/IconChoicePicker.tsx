import {
  createImageIconValue,
  createSvgIconValue,
  emojiIconChoices,
  svgIconChoices,
  type UploadedIconAsset,
} from './icon-value'
import { IconMark } from './IconMark'
import styles from './IconValue.module.css'

interface IconChoicePickerProps {
  allowEmpty?: boolean | undefined
  className?: string | undefined
  label: string
  showEmojiChoices?: boolean | undefined
  uploadedIcons?: UploadedIconAsset[] | undefined
  value: string
  onChange: (value: string) => void
}

export function IconChoicePicker({
  allowEmpty = true,
  className,
  label,
  showEmojiChoices = true,
  uploadedIcons = [],
  value,
  onChange,
}: IconChoicePickerProps) {
  const rootClassName = className
    ? `${styles.picker} ${className}`
    : styles.picker

  return (
    <div className={rootClassName}>
      <span className={styles.pickerLabel}>{label}</span>
      <div className={styles.optionList}>
        {allowEmpty ? (
          <IconOptionButton
            label="Без иконки"
            selected={value === ''}
            value=""
            uploadedIcons={uploadedIcons}
            onChange={onChange}
          />
        ) : null}

        {uploadedIcons.map((uploadedIcon) => {
          const iconValue = createImageIconValue(uploadedIcon.id)

          return (
            <IconOptionButton
              key={iconValue}
              label={uploadedIcon.label}
              selected={value === iconValue}
              value={iconValue}
              uploadedIcons={uploadedIcons}
              onChange={onChange}
            />
          )
        })}

        {showEmojiChoices
          ? emojiIconChoices.map((emojiIcon) => (
              <IconOptionButton
                key={emojiIcon}
                label={emojiIcon}
                selected={value === emojiIcon}
                value={emojiIcon}
                uploadedIcons={uploadedIcons}
                onChange={onChange}
              />
            ))
          : null}

        {svgIconChoices.map((svgIconName) => {
          const iconValue = createSvgIconValue(svgIconName)

          return (
            <IconOptionButton
              key={iconValue}
              label={svgIconName}
              selected={value === iconValue || value === svgIconName}
              value={iconValue}
              uploadedIcons={uploadedIcons}
              onChange={onChange}
            />
          )
        })}
      </div>
    </div>
  )
}

interface IconOptionButtonProps {
  label: string
  selected: boolean
  uploadedIcons: UploadedIconAsset[]
  value: string
  onChange: (value: string) => void
}

function IconOptionButton({
  label,
  selected,
  uploadedIcons,
  value,
  onChange,
}: IconOptionButtonProps) {
  return (
    <button
      className={`${styles.optionButton} ${
        selected ? styles.optionButtonActive : ''
      }`}
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={() => onChange(value)}
    >
      <IconMark value={value} uploadedIcons={uploadedIcons} />
    </button>
  )
}
