import type { ReactNode } from 'react'

import styles from './SelfCarePage.module.css'

export function SelfCareSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className={styles.sectionBlock}>
      <h2>{title}</h2>
      <div className={styles.cardList}>{children}</div>
    </section>
  )
}
