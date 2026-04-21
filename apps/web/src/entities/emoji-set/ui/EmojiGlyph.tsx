import type { EmojiAssetKind } from '../model/emoji-set.types'
import styles from './EmojiGlyph.module.css'

interface EmojiGlyphProps {
  className?: string | undefined
  kind: EmojiAssetKind
  label?: string | undefined
  value: string
}

export function EmojiGlyph({ className, kind, label, value }: EmojiGlyphProps) {
  const rootClassName = className
    ? `${styles.glyph} ${className}`
    : styles.glyph

  if (kind === 'image') {
    return (
      <span className={rootClassName}>
        <img className={styles.image} src={value} alt={label ?? ''} />
      </span>
    )
  }

  return (
    <span
      className={rootClassName}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {value}
    </span>
  )
}
