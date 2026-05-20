import type { SessionResponse } from '@planner/contracts'
import { type FormEvent, useState } from 'react'

import {
  getCreateSharedWorkspaceErrorMessage,
  getDeleteSharedWorkspaceErrorMessage,
  getLeaveSharedWorkspaceErrorMessage,
  getUpdateSharedWorkspaceErrorMessage,
  getWorkspaceParticipantsErrorMessage,
  useAcceptWorkspaceInvitation,
  useCreateSharedWorkspace,
  useDeclineWorkspaceInvitation,
  useDeleteSharedWorkspace,
  useLeaveSharedWorkspace,
  useReceivedWorkspaceInvitations,
  useUpdateSharedWorkspace,
} from '@/features/session'

import type { WorkspaceInvitationAcceptInput } from './SidebarWorkspaceActionTypes'

export function useSidebarWorkspaceActionsModel({
  onCloseMobileMoreSheet,
  session,
}: {
  onCloseMobileMoreSheet: () => void
  session: SessionResponse
}) {
  const createSharedWorkspaceMutation = useCreateSharedWorkspace()
  const updateSharedWorkspaceMutation = useUpdateSharedWorkspace()
  const deleteSharedWorkspaceMutation = useDeleteSharedWorkspace()
  const leaveSharedWorkspaceMutation = useLeaveSharedWorkspace()
  const receivedWorkspaceInvitationsQuery = useReceivedWorkspaceInvitations()
  const acceptWorkspaceInvitationMutation = useAcceptWorkspaceInvitation()
  const declineWorkspaceInvitationMutation = useDeclineWorkspaceInvitation()
  const [isCreateWorkspaceFormOpen, setIsCreateWorkspaceFormOpen] =
    useState(false)
  const [createWorkspaceName, setCreateWorkspaceName] = useState('')
  const [createWorkspaceFormError, setCreateWorkspaceFormError] = useState<
    string | null
  >(null)
  const [isRenameWorkspaceFormOpen, setIsRenameWorkspaceFormOpen] =
    useState(false)
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('')
  const [workspaceManageError, setWorkspaceManageError] = useState<
    string | null
  >(null)
  const [workspaceInvitationError, setWorkspaceInvitationError] = useState<
    string | null
  >(null)
  const isSharedWorkspace = session.workspace.kind === 'shared'
  const canManageCurrentSharedWorkspace =
    session.workspace.kind === 'shared' && session.role === 'owner'
  const sharedWorkspaceCount = session.workspaces.filter(
    (workspace) => workspace.kind === 'shared',
  ).length
  const receivedWorkspaceInvitations =
    receivedWorkspaceInvitationsQuery.data?.invitations ?? []
  const createWorkspaceError =
    createWorkspaceFormError ||
    (createSharedWorkspaceMutation.error
      ? getCreateSharedWorkspaceErrorMessage(
          createSharedWorkspaceMutation.error,
        )
      : null)
  const workspaceOwnerActionError =
    workspaceManageError ||
    (updateSharedWorkspaceMutation.error
      ? getUpdateSharedWorkspaceErrorMessage(
          updateSharedWorkspaceMutation.error,
        )
      : deleteSharedWorkspaceMutation.error
        ? getDeleteSharedWorkspaceErrorMessage(
            deleteSharedWorkspaceMutation.error,
          )
        : null)
  const workspaceLeaveActionError = leaveSharedWorkspaceMutation.error
    ? getLeaveSharedWorkspaceErrorMessage(leaveSharedWorkspaceMutation.error)
    : null

  function closeCreateWorkspaceForm() {
    setIsCreateWorkspaceFormOpen(false)
    setCreateWorkspaceName('')
    setCreateWorkspaceFormError(null)
    createSharedWorkspaceMutation.reset()
  }

  function openCreateWorkspaceForm() {
    setIsCreateWorkspaceFormOpen(true)
    setCreateWorkspaceFormError(null)
    createSharedWorkspaceMutation.reset()
  }

  function handleCreateWorkspaceNameChange(name: string) {
    setCreateWorkspaceName(name)
    setCreateWorkspaceFormError(null)
  }

  async function handleCreateWorkspaceSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const name = createWorkspaceName.trim()

    if (!name) {
      setCreateWorkspaceFormError('Введите название пространства.')
      return
    }

    setCreateWorkspaceFormError(null)

    try {
      await createSharedWorkspaceMutation.mutateAsync({ name })
      closeCreateWorkspaceForm()
    } catch (error) {
      setCreateWorkspaceFormError(getCreateSharedWorkspaceErrorMessage(error))
    }
  }

  function closeRenameWorkspaceForm() {
    setIsRenameWorkspaceFormOpen(false)
    setWorkspaceManageError(null)
    setRenameWorkspaceName(session.workspace.name)
    updateSharedWorkspaceMutation.reset()
    deleteSharedWorkspaceMutation.reset()
  }

  function openRenameWorkspaceForm() {
    setIsRenameWorkspaceFormOpen(true)
    setWorkspaceManageError(null)
    setRenameWorkspaceName(session.workspace.name)
    updateSharedWorkspaceMutation.reset()
    deleteSharedWorkspaceMutation.reset()
  }

  function handleRenameWorkspaceNameChange(name: string) {
    setRenameWorkspaceName(name)
    setWorkspaceManageError(null)
  }

  async function handleRenameWorkspaceSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const name = renameWorkspaceName.trim()

    if (!name) {
      setWorkspaceManageError('Введите новое название пространства.')
      return
    }

    if (name === session.workspace.name.trim()) {
      closeRenameWorkspaceForm()
      return
    }

    setWorkspaceManageError(null)

    try {
      await updateSharedWorkspaceMutation.mutateAsync({ name })
      closeRenameWorkspaceForm()
    } catch (error) {
      setWorkspaceManageError(getUpdateSharedWorkspaceErrorMessage(error))
    }
  }

  async function handleDeleteWorkspace() {
    if (
      !window.confirm(
        `Удалить пространство «${session.workspace.name}» вместе со всеми данными?`,
      )
    ) {
      return
    }

    setWorkspaceManageError(null)
    updateSharedWorkspaceMutation.reset()
    deleteSharedWorkspaceMutation.reset()

    try {
      await deleteSharedWorkspaceMutation.mutateAsync()
      setIsRenameWorkspaceFormOpen(false)
      onCloseMobileMoreSheet()
    } catch (error) {
      setWorkspaceManageError(getDeleteSharedWorkspaceErrorMessage(error))
    }
  }

  async function handleLeaveWorkspace() {
    if (!window.confirm(`Выйти из пространства «${session.workspace.name}»?`)) {
      return
    }

    setWorkspaceManageError(null)
    leaveSharedWorkspaceMutation.reset()

    try {
      await leaveSharedWorkspaceMutation.mutateAsync()
      setIsRenameWorkspaceFormOpen(false)
      onCloseMobileMoreSheet()
    } catch (error) {
      setWorkspaceManageError(getLeaveSharedWorkspaceErrorMessage(error))
    }
  }

  async function handleAcceptInvitation(input: WorkspaceInvitationAcceptInput) {
    setWorkspaceInvitationError(null)

    try {
      await acceptWorkspaceInvitationMutation.mutateAsync(input)
      onCloseMobileMoreSheet()
    } catch (error) {
      setWorkspaceInvitationError(getWorkspaceParticipantsErrorMessage(error))
    }
  }

  async function handleDeclineInvitation(invitationId: string) {
    setWorkspaceInvitationError(null)

    try {
      await declineWorkspaceInvitationMutation.mutateAsync(invitationId)
    } catch (error) {
      setWorkspaceInvitationError(getWorkspaceParticipantsErrorMessage(error))
    }
  }

  return {
    canManageCurrentSharedWorkspace,
    createWorkspace: {
      error: createWorkspaceError,
      isOpen: isCreateWorkspaceFormOpen,
      isPending: createSharedWorkspaceMutation.isPending,
      name: createWorkspaceName,
      onClose: closeCreateWorkspaceForm,
      onNameChange: handleCreateWorkspaceNameChange,
      onOpen: openCreateWorkspaceForm,
      onSubmit: handleCreateWorkspaceSubmit,
      sharedWorkspaceCount,
    },
    invitations: {
      acceptVariables: acceptWorkspaceInvitationMutation.variables,
      declineVariables: declineWorkspaceInvitationMutation.variables,
      error: workspaceInvitationError,
      isAccepting: acceptWorkspaceInvitationMutation.isPending,
      isDeclining: declineWorkspaceInvitationMutation.isPending,
      items: receivedWorkspaceInvitations,
      onAccept: handleAcceptInvitation,
      onDecline: handleDeclineInvitation,
    },
    isSharedWorkspace,
    leaveWorkspace: {
      error: workspaceLeaveActionError,
      isPending: leaveSharedWorkspaceMutation.isPending,
      onLeave: handleLeaveWorkspace,
    },
    ownerWorkspace: {
      error: workspaceOwnerActionError,
      isDeletePending: deleteSharedWorkspaceMutation.isPending,
      isOpen: isRenameWorkspaceFormOpen,
      isRenamePending: updateSharedWorkspaceMutation.isPending,
      onClose: closeRenameWorkspaceForm,
      onDelete: handleDeleteWorkspace,
      onNameChange: handleRenameWorkspaceNameChange,
      onOpen: openRenameWorkspaceForm,
      onSubmit: handleRenameWorkspaceSubmit,
      renameWorkspaceName,
    },
  }
}
