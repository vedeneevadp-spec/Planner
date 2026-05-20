import type { ReceivedWorkspaceInvitationRecord } from '@planner/contracts'
import type { FormEvent } from 'react'

import { cx } from '@/shared/lib/classnames'
import {
  CheckIcon,
  CloseIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from '@/shared/ui/Icon'

import styles from './Sidebar.module.css'
import type { WorkspaceInvitationAcceptInput } from './SidebarWorkspaceActionTypes'

export function CreateWorkspaceControls({
  createWorkspaceError,
  createWorkspaceName,
  extraClassName,
  isCreateWorkspaceFormOpen,
  isPending,
  onClose,
  onNameChange,
  onOpen,
  onSubmit,
  sharedWorkspaceCount,
}: {
  createWorkspaceError: string | null
  createWorkspaceName: string
  extraClassName?: string | undefined
  isCreateWorkspaceFormOpen: boolean
  isPending: boolean
  onClose: () => void
  onNameChange: (name: string) => void
  onOpen: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  sharedWorkspaceCount: number
}) {
  return (
    <>
      <button
        className={cx(styles.createWorkspaceButton, extraClassName)}
        type="button"
        aria-expanded={isCreateWorkspaceFormOpen}
        disabled={isPending || sharedWorkspaceCount >= 3}
        onClick={() => {
          if (isCreateWorkspaceFormOpen) {
            onClose()
            return
          }

          onOpen()
        }}
      >
        <PlusIcon size={18} strokeWidth={2.15} />
        <span>Создать пространство</span>
      </button>

      {isCreateWorkspaceFormOpen ? (
        <form
          className={styles.workspaceInlineForm}
          onSubmit={(event) => {
            onSubmit(event)
          }}
        >
          <label className={styles.workspaceFormField}>
            <span>Название</span>
            <input
              type="text"
              value={createWorkspaceName}
              maxLength={80}
              placeholder="Например, Семья"
              onChange={(event) => {
                onNameChange(event.target.value)
              }}
            />
          </label>

          <div className={styles.workspaceFormActions}>
            <button
              className={styles.inlinePrimaryButton}
              type="submit"
              disabled={isPending}
            >
              <CheckIcon size={16} strokeWidth={2.15} />
              <span>{isPending ? 'Создаём...' : 'Создать'}</span>
            </button>

            <button
              className={styles.inlineGhostButton}
              type="button"
              disabled={isPending}
              onClick={onClose}
            >
              <CloseIcon size={16} strokeWidth={2.15} />
              <span>Отмена</span>
            </button>
          </div>
        </form>
      ) : null}

      {createWorkspaceError ? (
        <p className={styles.connectionError}>{createWorkspaceError}</p>
      ) : null}
    </>
  )
}

export function WorkspaceOwnerControls({
  error,
  extraClassName,
  isDeletePending,
  isOpen,
  isRenamePending,
  isVisible,
  onClose,
  onDelete,
  onNameChange,
  onOpen,
  onSubmit,
  renameWorkspaceName,
}: {
  error: string | null
  extraClassName?: string | undefined
  isDeletePending: boolean
  isOpen: boolean
  isRenamePending: boolean
  isVisible: boolean
  onClose: () => void
  onDelete: () => void
  onNameChange: (name: string) => void
  onOpen: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  renameWorkspaceName: string
}) {
  if (!isVisible) {
    return null
  }

  return (
    <>
      <div className={styles.workspaceOwnerActions}>
        <button
          className={cx(
            styles.createWorkspaceButton,
            styles.secondaryWorkspaceButton,
            styles.workspaceActionButton,
            extraClassName,
          )}
          type="button"
          aria-expanded={isOpen}
          disabled={isRenamePending}
          onClick={() => {
            if (isOpen) {
              onClose()
              return
            }

            onOpen()
          }}
        >
          <EditIcon size={18} strokeWidth={2.1} />
          <span>Переименовать</span>
        </button>

        <button
          className={cx(
            styles.createWorkspaceButton,
            styles.workspaceDeleteButton,
            styles.workspaceActionButton,
            extraClassName,
          )}
          type="button"
          disabled={isDeletePending}
          onClick={onDelete}
        >
          <TrashIcon size={18} strokeWidth={2.1} />
          <span>{isDeletePending ? 'Удаляем...' : 'Удалить'}</span>
        </button>
      </div>

      {isOpen ? (
        <form
          className={styles.workspaceInlineForm}
          onSubmit={(event) => {
            onSubmit(event)
          }}
        >
          <label className={styles.workspaceFormField}>
            <span>Новое название</span>
            <input
              type="text"
              value={renameWorkspaceName}
              maxLength={80}
              placeholder="Название пространства"
              onChange={(event) => {
                onNameChange(event.target.value)
              }}
            />
          </label>

          <div className={styles.workspaceFormActions}>
            <button
              className={styles.inlinePrimaryButton}
              type="submit"
              disabled={isRenamePending}
            >
              <CheckIcon size={16} strokeWidth={2.15} />
              <span>{isRenamePending ? 'Сохраняем...' : 'Сохранить'}</span>
            </button>

            <button
              className={styles.inlineGhostButton}
              type="button"
              disabled={isRenamePending}
              onClick={onClose}
            >
              <CloseIcon size={16} strokeWidth={2.15} />
              <span>Отмена</span>
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className={styles.connectionError}>{error}</p> : null}
    </>
  )
}

export function WorkspaceLeaveControls({
  error,
  extraClassName,
  isPending,
  isVisible,
  onLeave,
}: {
  error: string | null
  extraClassName?: string | undefined
  isPending: boolean
  isVisible: boolean
  onLeave: () => void
}) {
  if (!isVisible) {
    return null
  }

  return (
    <>
      <button
        className={cx(
          styles.createWorkspaceButton,
          styles.workspaceDeleteButton,
          styles.workspaceActionButton,
          extraClassName,
        )}
        type="button"
        disabled={isPending}
        onClick={onLeave}
      >
        <TrashIcon size={18} strokeWidth={2.1} />
        <span>{isPending ? 'Выходим...' : 'Выйти из пространства'}</span>
      </button>

      {error ? <p className={styles.connectionError}>{error}</p> : null}
    </>
  )
}

export function ReceivedInvitations({
  acceptVariables,
  declineVariables,
  error,
  extraClassName,
  invitations,
  isAccepting,
  isDeclining,
  onAccept,
  onDecline,
}: {
  acceptVariables?: WorkspaceInvitationAcceptInput | undefined
  declineVariables?: string | undefined
  error: string | null
  extraClassName?: string | undefined
  invitations: ReceivedWorkspaceInvitationRecord[]
  isAccepting: boolean
  isDeclining: boolean
  onAccept: (input: WorkspaceInvitationAcceptInput) => void
  onDecline: (invitationId: string) => void
}) {
  if (invitations.length === 0) {
    return null
  }

  return (
    <div className={cx(styles.invitationPanel, extraClassName)}>
      <p className={styles.invitationPanelTitle}>Приглашения</p>

      {invitations.map((invitation) => {
        const isAcceptingInvitation =
          isAccepting && acceptVariables?.invitationId === invitation.id
        const isDecliningInvitation =
          isDeclining && declineVariables === invitation.id

        return (
          <article key={invitation.id} className={styles.invitationCard}>
            <div className={styles.invitationCopy}>
              <strong>{invitation.workspace.name}</strong>
              <span>{getGroupRoleLabel(invitation.groupRole)}</span>
            </div>
            <div className={styles.invitationActions}>
              <button
                className={styles.inlinePrimaryButton}
                type="button"
                disabled={isAcceptingInvitation || isDecliningInvitation}
                onClick={() => {
                  onAccept({
                    invitationId: invitation.id,
                    workspaceId: invitation.workspace.id,
                  })
                }}
              >
                <CheckIcon size={16} strokeWidth={2.15} />
                <span>{isAcceptingInvitation ? 'Входим...' : 'Вступить'}</span>
              </button>
              <button
                className={styles.inlineGhostButton}
                type="button"
                disabled={isAcceptingInvitation || isDecliningInvitation}
                onClick={() => {
                  onDecline(invitation.id)
                }}
              >
                <CloseIcon size={16} strokeWidth={2.15} />
                <span>
                  {isDecliningInvitation ? 'Отклоняем...' : 'Отклонить'}
                </span>
              </button>
            </div>
          </article>
        )
      })}

      {error ? <p className={styles.connectionError}>{error}</p> : null}
    </div>
  )
}

export function WorkspaceParticipantsButton({
  extraClassName,
  onOpen,
}: {
  extraClassName?: string | undefined
  onOpen: () => void
}) {
  return (
    <button
      className={cx(
        styles.createWorkspaceButton,
        extraClassName,
        styles.secondaryWorkspaceButton,
      )}
      type="button"
      onClick={onOpen}
    >
      <UserIcon size={18} strokeWidth={2.1} />
      <span>Участники</span>
    </button>
  )
}

function getGroupRoleLabel(role: string): string {
  if (role === 'group_admin') {
    return 'Group Admin'
  }

  if (role === 'senior_member') {
    return 'Senior Member'
  }

  return 'Member'
}
