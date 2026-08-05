import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { cx } from '@/shared/lib/classnames'

import styles from './TodayRoutineCard.module.css'

export type TodayRoutineCardVariant = 'card' | 'compact'
export type TodayRoutineCardTone = 'default' | 'shopping'

interface TodayRoutineCardContentProps {
  icon: ReactNode
  meta: string
  title: string
}

interface TodayRoutineCardBaseProps extends TodayRoutineCardContentProps {
  ariaLabel: string
  tone?: TodayRoutineCardTone
  variant: TodayRoutineCardVariant
}

interface TodayRoutineLinkCardProps extends TodayRoutineCardBaseProps {
  to: string
}

interface TodayRoutineActionCardProps extends TodayRoutineCardBaseProps {
  disabled?: boolean
  onClick: () => void
}

function getCardClassName(
  variant: TodayRoutineCardVariant,
  tone: TodayRoutineCardTone,
) {
  return cx(
    styles.card,
    variant === 'compact' && styles.cardCompact,
    tone === 'shopping' && styles.cardShopping,
  )
}

function TodayRoutineCardContent({
  icon,
  meta,
  title,
}: TodayRoutineCardContentProps) {
  return (
    <>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>{meta}</span>
      </span>
    </>
  )
}

export function TodayRoutineLinkCard({
  ariaLabel,
  icon,
  meta,
  title,
  to,
  tone = 'default',
  variant,
}: TodayRoutineLinkCardProps) {
  return (
    <Link
      aria-label={ariaLabel}
      className={getCardClassName(variant, tone)}
      to={to}
    >
      <TodayRoutineCardContent icon={icon} meta={meta} title={title} />
    </Link>
  )
}

export function TodayRoutineActionCard({
  ariaLabel,
  disabled = false,
  icon,
  meta,
  onClick,
  title,
  tone = 'default',
  variant,
}: TodayRoutineActionCardProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={getCardClassName(variant, tone)}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <TodayRoutineCardContent icon={icon} meta={meta} title={title} />
    </button>
  )
}
