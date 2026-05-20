import type { SessionResponse } from '@planner/contracts'

import { cx } from '@/shared/lib/classnames'

import styles from './Sidebar.module.css'
import {
  CreateWorkspaceControls,
  ReceivedInvitations,
  WorkspaceLeaveControls,
  WorkspaceOwnerControls,
  WorkspaceParticipantsButton,
} from './SidebarWorkspaceActionControls'
import { useSidebarWorkspaceActionsModel } from './useSidebarWorkspaceActionsModel'

interface SidebarWorkspaceActionsProps {
  isMobile?: boolean
  onCloseMobileMoreSheet: () => void
  onOpenParticipants: () => void
  session: SessionResponse
}

export function SidebarWorkspaceActions({
  isMobile = false,
  onCloseMobileMoreSheet,
  onOpenParticipants,
  session,
}: SidebarWorkspaceActionsProps) {
  const workspaceActions = useSidebarWorkspaceActionsModel({
    onCloseMobileMoreSheet,
    session,
  })
  const actionButtonClassName = isMobile
    ? styles.mobileCreateWorkspaceButton
    : undefined

  return (
    <div
      className={cx(
        styles.workspaceActionsMenu,
        isMobile && styles.mobileWorkspaceActionsMenu,
      )}
    >
      <CreateWorkspaceControls
        createWorkspaceError={workspaceActions.createWorkspace.error}
        createWorkspaceName={workspaceActions.createWorkspace.name}
        isCreateWorkspaceFormOpen={workspaceActions.createWorkspace.isOpen}
        isPending={workspaceActions.createWorkspace.isPending}
        onClose={workspaceActions.createWorkspace.onClose}
        onNameChange={workspaceActions.createWorkspace.onNameChange}
        onOpen={workspaceActions.createWorkspace.onOpen}
        onSubmit={(event) => {
          void workspaceActions.createWorkspace.onSubmit(event)
        }}
        sharedWorkspaceCount={
          workspaceActions.createWorkspace.sharedWorkspaceCount
        }
        extraClassName={actionButtonClassName}
      />

      <ReceivedInvitations
        acceptVariables={workspaceActions.invitations.acceptVariables}
        declineVariables={workspaceActions.invitations.declineVariables}
        error={workspaceActions.invitations.error}
        invitations={workspaceActions.invitations.items}
        isAccepting={workspaceActions.invitations.isAccepting}
        isDeclining={workspaceActions.invitations.isDeclining}
        onAccept={(input) => {
          void workspaceActions.invitations.onAccept(input)
        }}
        onDecline={(invitationId) => {
          void workspaceActions.invitations.onDecline(invitationId)
        }}
        extraClassName={isMobile ? styles.mobileInvitationPanel : undefined}
      />

      <WorkspaceOwnerControls
        error={workspaceActions.ownerWorkspace.error}
        extraClassName={actionButtonClassName}
        isDeletePending={workspaceActions.ownerWorkspace.isDeletePending}
        isOpen={workspaceActions.ownerWorkspace.isOpen}
        isRenamePending={workspaceActions.ownerWorkspace.isRenamePending}
        isVisible={workspaceActions.canManageCurrentSharedWorkspace}
        onClose={workspaceActions.ownerWorkspace.onClose}
        onDelete={() => {
          void workspaceActions.ownerWorkspace.onDelete()
        }}
        onNameChange={workspaceActions.ownerWorkspace.onNameChange}
        onOpen={workspaceActions.ownerWorkspace.onOpen}
        onSubmit={(event) => {
          void workspaceActions.ownerWorkspace.onSubmit(event)
        }}
        renameWorkspaceName={
          workspaceActions.ownerWorkspace.renameWorkspaceName
        }
      />

      <WorkspaceLeaveControls
        error={workspaceActions.leaveWorkspace.error}
        extraClassName={actionButtonClassName}
        isPending={workspaceActions.leaveWorkspace.isPending}
        isVisible={
          workspaceActions.isSharedWorkspace &&
          !workspaceActions.canManageCurrentSharedWorkspace
        }
        onLeave={() => {
          void workspaceActions.leaveWorkspace.onLeave()
        }}
      />

      {workspaceActions.isSharedWorkspace ? (
        <WorkspaceParticipantsButton
          extraClassName={actionButtonClassName}
          onOpen={onOpenParticipants}
        />
      ) : null}
    </div>
  )
}
