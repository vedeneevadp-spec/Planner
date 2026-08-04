import { useState } from 'react'

import { usePlannerSession } from '@/features/session'
import { TrashIcon } from '@/shared/ui/Icon'

import {
  getDeleteUserAccountErrorMessage,
  useDeleteCurrentUserAccount,
} from '../lib/useDeleteCurrentUserAccount'
import { AccountDeletionDialog } from './AccountDeletionDialog'
import styles from './AccountDeletionPanel.module.css'

export function AccountDeletionPanel() {
  const session = usePlannerSession().data
  const deleteAccount = useDeleteCurrentUserAccount()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const isOwner = session?.appRole === 'owner'

  if (!session) {
    return null
  }

  return (
    <section className={styles.panel}>
      <div className={styles.copy}>
        <p className={styles.kicker}>Опасная зона</p>
        <h3>Удаление аккаунта</h3>
        <p>
          Аккаунт, workspace’ы и все связанные данные будут удалены без
          возможности восстановления через интерфейс.
        </p>
        {isOwner ? (
          <p className={styles.ownerNote}>
            Глобальный owner защищён от удаления, чтобы приложение не осталось
            без владельца.
          </p>
        ) : null}
      </div>

      <button
        className={styles.deleteButton}
        type="button"
        disabled={isOwner}
        onClick={() => {
          deleteAccount.reset()
          setIsDialogOpen(true)
        }}
      >
        <TrashIcon size={17} strokeWidth={2.1} />
        <span>Удалить аккаунт</span>
      </button>

      <AccountDeletionDialog
        displayName={session.actor.displayName}
        email={session.actor.email}
        errorMessage={
          deleteAccount.error
            ? getDeleteUserAccountErrorMessage(deleteAccount.error)
            : null
        }
        isOpen={isDialogOpen}
        isPending={deleteAccount.isPending}
        onCancel={() => setIsDialogOpen(false)}
        onConfirm={() => {
          void deleteAccount.mutateAsync().catch(() => undefined)
        }}
      />
    </section>
  )
}
