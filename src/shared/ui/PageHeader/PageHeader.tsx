import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  description: string
  kicker: string
}

export function PageHeader({ title, description, kicker }: PageHeaderProps) {
  return (
    <header className={styles.root}>
      <div>
        <p className={styles.eyebrow}>{kicker}</p>
        <h2>{title}</h2>
      </div>
      <p className={styles.description}>{description}</p>
    </header>
  )
}
