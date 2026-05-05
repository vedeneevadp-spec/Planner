import { cx } from '@/shared/lib/classnames'

import styles from './UserAvatar.module.css'

interface UserAvatarProps {
  avatarUrl?: string | null
  className?: string | undefined
  displayName: string
  email?: string | undefined
  size?: 'sm' | 'md' | 'lg'
}

export function UserAvatar({
  avatarUrl,
  className,
  displayName,
  email,
  size = 'md',
}: UserAvatarProps) {
  const initials = getAvatarInitials(displayName, email)

  return (
    <span
      className={cx(styles.avatar, className)}
      data-size={size}
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img className={styles.image} src={avatarUrl} alt="" />
      ) : (
        <span className={styles.initials}>{initials}</span>
      )}
    </span>
  )
}

function getAvatarInitials(displayName: string, email?: string): string {
  const baseValue = displayName.trim() || email?.trim() || '?'
  const words = baseValue.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
  }

  return baseValue.slice(0, 2).toUpperCase()
}
