import { useNavigate } from 'react-router-dom'

import { ProfileAccountPanel } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import pageStyles from '@/shared/ui/Page'

import styles from './ProfilePage.module.css'

export function ProfilePage() {
  const navigate = useNavigate()

  return (
    <section className={cx(pageStyles.page, styles.profilePage)}>
      <ProfileAccountPanel
        cancelLabel="К задачам"
        showCloseButton={false}
        variant="page"
        onCancel={() => {
          void navigate('/today')
        }}
      />
    </section>
  )
}
