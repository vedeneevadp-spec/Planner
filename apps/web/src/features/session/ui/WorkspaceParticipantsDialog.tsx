import type {
  AssignableWorkspaceGroupRole,
  WorkspaceUserRecord,
} from '@planner/contracts'
import { type FormEvent, useEffect, useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { CloseIcon, PlusIcon, TrashIcon, UserIcon } from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import { usePlannerSession } from '../lib/usePlannerSession'
import {
  getWorkspaceParticipantsErrorMessage,
  useCreateWorkspaceInvitation,
  useRemoveWorkspaceUser,
  useRevokeWorkspaceInvitation,
  useUpdateWorkspaceUserGroupRole,
  useWorkspaceInvitations,
  useWorkspaceUsers,
} from '../lib/useWorkspaceParticipants'
import styles from './WorkspaceParticipantsDialog.module.css'

const MANAGEABLE_WORKSPACE_ROLES = [
  'group_admin',
  'senior_member',
  'member',
] satisfies AssignableWorkspaceGroupRole[]

const GROUP_ROLE_LABELS = {
  group_admin: 'Group Admin',
  member: 'Member',
  owner: 'Owner',
  senior_member: 'Senior Member',
} satisfies Record<AssignableWorkspaceGroupRole | 'owner', string>

interface WorkspaceParticipantsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function WorkspaceParticipantsDialog({
  isOpen,
  onClose,
}: WorkspaceParticipantsDialogProps) {
  const sessionQuery = usePlannerSession()
  const session = sessionQuery.data
  const isSharedWorkspace = session?.workspace.kind === 'shared'
  const canManage =
    isSharedWorkspace &&
    (session?.role === 'owner' || session?.groupRole === 'group_admin')
  const usersQuery = useWorkspaceUsers({
    enabled: isOpen && isSharedWorkspace,
  })
  const invitationsQuery = useWorkspaceInvitations({
    enabled: isOpen && canManage,
  })
  const createWorkspaceInvitation = useCreateWorkspaceInvitation()
  const updateWorkspaceUserGroupRole = useUpdateWorkspaceUserGroupRole()
  const removeWorkspaceUser = useRemoveWorkspaceUser()
  const revokeWorkspaceInvitation = useRevokeWorkspaceInvitation()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteGroupRole, setInviteGroupRole] =
    useState<AssignableWorkspaceGroupRole>('member')
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  const users = usersQuery.data?.users ?? []
  const invitations = invitationsQuery.data?.invitations ?? []
  const usersError = usersQuery.error
    ? getWorkspaceParticipantsErrorMessage(usersQuery.error)
    : null
  const invitationsError = invitationsQuery.error
    ? getWorkspaceParticipantsErrorMessage(invitationsQuery.error)
    : null

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setActionError(null)

    if (!inviteEmail.trim()) {
      setFormError('Укажите email участника.')
      return
    }

    try {
      await createWorkspaceInvitation.mutateAsync({
        email: inviteEmail,
        groupRole: inviteGroupRole,
      })
      setInviteEmail('')
      setInviteGroupRole('member')
    } catch (error) {
      setFormError(getWorkspaceParticipantsErrorMessage(error))
    }
  }

  async function handleRoleChange(
    user: WorkspaceUserRecord,
    nextGroupRole: AssignableWorkspaceGroupRole,
  ) {
    setActionError(null)

    try {
      await updateWorkspaceUserGroupRole.mutateAsync({
        groupRole: nextGroupRole,
        membershipId: user.membershipId,
      })
    } catch (error) {
      setActionError(getWorkspaceParticipantsErrorMessage(error))
    }
  }

  async function handleRemoveUser(user: WorkspaceUserRecord) {
    if (!window.confirm(`Убрать ${user.email} из workspace?`)) {
      return
    }

    setActionError(null)

    try {
      await removeWorkspaceUser.mutateAsync(user.membershipId)
    } catch (error) {
      setActionError(getWorkspaceParticipantsErrorMessage(error))
    }
  }

  async function handleRevokeInvitation(invitationId: string, email: string) {
    if (!window.confirm(`Отозвать приглашение для ${email}?`)) {
      return
    }

    setActionError(null)

    try {
      await revokeWorkspaceInvitation.mutateAsync(invitationId)
    } catch (error) {
      setActionError(getWorkspaceParticipantsErrorMessage(error))
    }
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={() => {
        onClose()
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-participants-title"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <p className={styles.kicker}>Shared Workspace</p>
            <h2 id="workspace-participants-title">
              {session?.workspace.name ?? 'Участники'}
            </h2>
            <p>
              {canManage
                ? 'Приглашайте людей по email, меняйте роли и следите за pending invite.'
                : 'Здесь видно, кто уже работает в общем workspace.'}
            </p>
          </div>

          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть окно участников"
            onClick={() => {
              onClose()
            }}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </header>

        {!isSharedWorkspace ? (
          <section className={styles.infoCard}>
            <p>
              Управление участниками доступно только в общем workspace. Сейчас
              открыт personal workspace.
            </p>
          </section>
        ) : (
          <>
            <section className={styles.summaryGrid}>
              <article className={styles.metricCard}>
                <span>Участники</span>
                <strong>{users.length}</strong>
              </article>
              <article className={styles.metricCard}>
                <span>Приглашения</span>
                <strong>{canManage ? invitations.length : '—'}</strong>
              </article>
              <article className={styles.metricCard}>
                <span>Моя роль</span>
                <strong>
                  {session?.role === 'owner'
                    ? GROUP_ROLE_LABELS.owner
                    : GROUP_ROLE_LABELS[session?.groupRole ?? 'member']}
                </strong>
              </article>
            </section>

            {canManage ? (
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h3>Пригласить участника</h3>
                  <p>
                    Приглашение привязывается к email и будет принято при
                    следующем входе пользователя.
                  </p>
                </div>

                <form
                  className={styles.inviteForm}
                  onSubmit={(event) => {
                    void handleInviteSubmit(event)
                  }}
                >
                  <label className={styles.field}>
                    <span>Email</span>
                    <input
                      type="email"
                      value={inviteEmail}
                      placeholder="teammate@example.com"
                      onChange={(event) => {
                        setInviteEmail(event.target.value)
                      }}
                    />
                  </label>

                  <SelectPicker
                    className={styles.field}
                    label="Групповая роль"
                    value={inviteGroupRole}
                    options={MANAGEABLE_WORKSPACE_ROLES.map((role) => ({
                      label: GROUP_ROLE_LABELS[role],
                      value: role,
                    }))}
                    onChange={(nextRole) => {
                      setInviteGroupRole(nextRole)
                    }}
                  />

                  <button
                    className={styles.primaryButton}
                    type="submit"
                    disabled={createWorkspaceInvitation.isPending}
                  >
                    <PlusIcon size={16} strokeWidth={2.15} />
                    <span>
                      {createWorkspaceInvitation.isPending
                        ? 'Отправляем...'
                        : 'Пригласить'}
                    </span>
                  </button>
                </form>

                {formError ? (
                  <p className={styles.errorText}>{formError}</p>
                ) : null}
              </section>
            ) : (
              <section className={styles.infoCard}>
                <p>
                  Менять состав участников и инвайты могут только owner и group
                  admin этого workspace.
                </p>
              </section>
            )}

            {actionError ? (
              <p className={styles.errorText}>{actionError}</p>
            ) : null}
            {usersError ? (
              <p className={styles.errorText}>{usersError}</p>
            ) : null}
            {invitationsError ? (
              <p className={styles.errorText}>{invitationsError}</p>
            ) : null}

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3>Текущие участники</h3>
                <p>
                  Group role определяет права внутри этого общего workspace.
                </p>
              </div>

              {usersQuery.isPending ? (
                <p className={styles.emptyState}>Загружаем участников...</p>
              ) : users.length === 0 ? (
                <p className={styles.emptyState}>
                  В этом workspace пока нет участников.
                </p>
              ) : (
                <div className={styles.list}>
                  {users.map((user) => {
                    const isCurrentUser = user.id === session?.actorUserId
                    const canEdit = canManage && !isCurrentUser && !user.isOwner
                    const isRemovingThisUser =
                      removeWorkspaceUser.isPending &&
                      removeWorkspaceUser.variables === user.membershipId
                    const isUpdatingThisUser =
                      updateWorkspaceUserGroupRole.isPending &&
                      updateWorkspaceUserGroupRole.variables?.membershipId ===
                        user.membershipId

                    return (
                      <article
                        key={user.membershipId}
                        className={styles.listItem}
                      >
                        <div className={styles.userLead}>
                          <div className={styles.avatar} aria-hidden="true">
                            <UserIcon size={18} strokeWidth={2.1} />
                          </div>

                          <div className={styles.userCopy}>
                            <div className={styles.userTitleRow}>
                              <strong>{user.displayName}</strong>
                              <span
                                className={cx(
                                  styles.roleBadge,
                                  getRoleBadgeClassName(
                                    user.isOwner
                                      ? 'owner'
                                      : (user.groupRole ?? 'member'),
                                  ),
                                )}
                              >
                                {user.isOwner
                                  ? GROUP_ROLE_LABELS.owner
                                  : GROUP_ROLE_LABELS[
                                      user.groupRole ?? 'member'
                                    ]}
                              </span>
                              {isCurrentUser ? (
                                <span className={styles.meBadge}>Вы</span>
                              ) : null}
                            </div>
                            <span>{user.email}</span>
                            <small>
                              В workspace с {formatTimestamp(user.joinedAt)}
                            </small>
                          </div>
                        </div>

                        <div className={styles.userActions}>
                          {canEdit ? (
                            <SelectPicker
                              className={styles.inlineField}
                              label="Групповая роль"
                              value={user.groupRole ?? 'member'}
                              disabled={
                                isUpdatingThisUser || isRemovingThisUser
                              }
                              options={MANAGEABLE_WORKSPACE_ROLES.map(
                                (role) => ({
                                  label: GROUP_ROLE_LABELS[role],
                                  value: role,
                                }),
                              )}
                              onChange={(nextRole) => {
                                void handleRoleChange(user, nextRole)
                              }}
                            />
                          ) : null}

                          {canEdit ? (
                            <button
                              className={styles.ghostButton}
                              type="button"
                              disabled={
                                isUpdatingThisUser || isRemovingThisUser
                              }
                              onClick={() => {
                                void handleRemoveUser(user)
                              }}
                            >
                              <TrashIcon size={16} strokeWidth={2.1} />
                              <span>
                                {isRemovingThisUser ? 'Удаляем...' : 'Убрать'}
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            {canManage ? (
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h3>Pending invite</h3>
                  <p>
                    Приглашение исчезнет отсюда, когда пользователь войдёт и
                    приглашение будет автоматически принято.
                  </p>
                </div>

                {invitationsQuery.isPending ? (
                  <p className={styles.emptyState}>Загружаем приглашения...</p>
                ) : invitations.length === 0 ? (
                  <p className={styles.emptyState}>
                    Сейчас нет активных приглашений.
                  </p>
                ) : (
                  <div className={styles.list}>
                    {invitations.map((invitation) => {
                      const isRevokingThisInvitation =
                        revokeWorkspaceInvitation.isPending &&
                        revokeWorkspaceInvitation.variables === invitation.id

                      return (
                        <article
                          key={invitation.id}
                          className={styles.listItem}
                        >
                          <div className={styles.userLead}>
                            <div className={styles.avatar} aria-hidden="true">
                              <PlusIcon size={18} strokeWidth={2.15} />
                            </div>

                            <div className={styles.userCopy}>
                              <div className={styles.userTitleRow}>
                                <strong>{invitation.email}</strong>
                                <span
                                  className={cx(
                                    styles.roleBadge,
                                    getRoleBadgeClassName(invitation.groupRole),
                                  )}
                                >
                                  {GROUP_ROLE_LABELS[invitation.groupRole]}
                                </span>
                              </div>
                              <small>
                                Приглашён{' '}
                                {formatTimestamp(invitation.invitedAt)}
                              </small>
                            </div>
                          </div>

                          <button
                            className={styles.ghostButton}
                            type="button"
                            disabled={isRevokingThisInvitation}
                            onClick={() => {
                              void handleRevokeInvitation(
                                invitation.id,
                                invitation.email,
                              )
                            }}
                          >
                            <TrashIcon size={16} strokeWidth={2.1} />
                            <span>
                              {isRevokingThisInvitation
                                ? 'Отзываем...'
                                : 'Отозвать'}
                            </span>
                          </button>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

function getRoleBadgeClassName(role: string): string {
  if (role === 'owner') {
    return styles.roleOwner ?? ''
  }

  if (role === 'group_admin') {
    return styles.roleAdmin ?? ''
  }

  if (role === 'senior_member') {
    return styles.roleGuest ?? ''
  }

  return styles.roleUser ?? ''
}

function formatTimestamp(value: string): string {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(parsedDate)
}
