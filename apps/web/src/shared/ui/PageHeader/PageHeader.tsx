import type { ReactNode } from 'react'

import styles from './PageHeader.module.css'

interface PageHeaderProps {
  actions?: ReactNode
  title?: string | undefined
  description?: string | undefined
  kicker: string
}

export function PageHeader({
  actions,
  title,
  description,
  kicker,
}: PageHeaderProps) {
  return (
    <header className={styles.root}>
      <div>
        <p className={styles.eyebrow}>{kicker}</p>
        {title ? <h2>{title}</h2> : null}
      </div>
      {description ? <p className={styles.description}>{description}</p> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}
