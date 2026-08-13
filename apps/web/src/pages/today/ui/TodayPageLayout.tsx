import type { ReactNode } from 'react'

import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import pageStyles from '@/shared/ui/Page'

import styles from './TodayPage.module.css'

interface TodayPageLayoutProps {
  children: ReactNode
  openDraft: TaskComposerDraft | null
  status?: ReactNode | undefined
  todayKey: string
}

export function TodayPageLayout({
  children,
  openDraft,
  status,
  todayKey,
}: TodayPageLayoutProps) {
  return (
    <section className={`${pageStyles.page} ${styles.todayPage}`}>
      <TaskComposer
        desktopOpenButtonHidden
        initialPlannedDate={todayKey}
        openDraft={openDraft}
      />

      <div className={styles.taskScroll}>
        <div className={styles.taskScrollInner}>
          {status}
          {children}
        </div>
      </div>
    </section>
  )
}

export function TodayPageStateLayout({ children }: { children: ReactNode }) {
  return (
    <section className={`${pageStyles.page} ${styles.todayPage}`}>
      <div className={styles.taskScroll}>
        <div className={styles.taskScrollInner}>{children}</div>
      </div>
    </section>
  )
}
