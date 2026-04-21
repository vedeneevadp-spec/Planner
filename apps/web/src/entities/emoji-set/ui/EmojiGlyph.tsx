import type { ReactEventHandler } from 'react'

import type { EmojiAssetKind } from '../model/emoji-set.types'
import styles from './EmojiGlyph.module.css'

interface EmojiGlyphProps {
  className?: string | undefined
  kind: EmojiAssetKind
  label?: string | undefined
  onError?: ReactEventHandler<HTMLImageElement> | undefined
  value: string
}

export function EmojiGlyph({
  className,
  kind,
  label,
  onError,
  value,
}: EmojiGlyphProps) {
  const rootClassName = className
    ? `${styles.glyph} ${className}`
    : styles.glyph

  return (
    <span className={rootClassName} data-kind={kind}>
      <img
        className={styles.image}
        src={value}
        alt={label ?? ''}
        onError={onError}
      />
    </span>
  )
}
