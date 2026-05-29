import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import type { SessionContext, SessionSnapshot } from './session.model.js'
import type { SessionRepository } from './session.repository.js'

export interface SessionRepositoryContractHarness {
  cleanup: () => Promise<void>
  createAuthenticatedSession: (input: {
    email: string
    userId: string
    workspaceId?: string | undefined
  }) => Promise<SessionSnapshot>
  immutableOwnerUserId: string
  memberSession: SessionSnapshot
  ownerSession: SessionSnapshot
  repository: SessionRepository
  resolveActorSession: (input: {
    userId: string
    workspaceId?: string | undefined
  }) => Promise<SessionSnapshot>
}

export function defineSessionRepositoryContractSuite(input: {
  createHarness: () => Promise<SessionRepositoryContractHarness>
  name: string
}): void {
  void describe(input.name, () => {
    void test('keeps shared workspace lifecycle consistent', async () => {
      const harness = await input.createHarness()

      try {
        const sharedWorkspace = await harness.repository.createSharedWorkspace(
          harness.ownerSession,
          {
            name: '  Contract Family  ',
          },
        )

        assert.equal(sharedWorkspace.kind, 'shared')
        assert.equal(sharedWorkspace.name, 'Contract Family')
        assert.equal(sharedWorkspace.role, 'owner')
        assert.equal(sharedWorkspace.groupRole, 'group_admin')

        const sharedOwnerSession = await harness.resolveActorSession({
          userId: harness.ownerSession.actorUserId,
          workspaceId: sharedWorkspace.id,
        })
        const renamedWorkspace = await harness.repository.updateSharedWorkspace(
          sharedOwnerSession,
          {
            name: 'Contract Home',
          },
        )

        assert.equal(renamedWorkspace.id, sharedWorkspace.id)
        assert.equal(renamedWorkspace.name, 'Contract Home')

        const resolvedSharedSession = await harness.resolveActorSession({
          userId: harness.ownerSession.actorUserId,
          workspaceId: sharedWorkspace.id,
        })

        assert.equal(resolvedSharedSession.workspace.name, 'Contract Home')

        await harness.repository.deleteSharedWorkspace(resolvedSharedSession)

        const ownerSessionAfterDelete = await harness.resolveActorSession({
          userId: harness.ownerSession.actorUserId,
        })

        assert.equal(
          ownerSessionAfterDelete.workspaces.some(
            (workspace) => workspace.id === sharedWorkspace.id,
          ),
          false,
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps workspace invitation acceptance and participant updates consistent', async () => {
      const harness = await input.createHarness()

      try {
        const sharedWorkspace = await harness.repository.createSharedWorkspace(
          harness.ownerSession,
          {
            name: 'Contract Invite Workspace',
          },
        )
        const ownerSharedSession = await harness.resolveActorSession({
          userId: harness.ownerSession.actorUserId,
          workspaceId: sharedWorkspace.id,
        })
        const inviteeUserId = randomUUID()
        const inviteeEmail = `contract-invitee-${inviteeUserId}@example.test`
        const invitation = await harness.repository.createWorkspaceInvitation(
          ownerSharedSession,
          {
            email: `  ${inviteeEmail.toUpperCase()}  `,
            groupRole: 'senior_member',
          },
        )

        assert.equal(invitation.email, inviteeEmail)
        assert.equal(invitation.groupRole, 'senior_member')
        assert.equal(invitation.status, 'pending')

        const inviteeSession = await harness.createAuthenticatedSession({
          email: inviteeEmail,
          userId: inviteeUserId,
        })
        const receivedInvitations =
          await harness.repository.listReceivedWorkspaceInvitations(
            inviteeSession,
          )

        assert.deepEqual(
          receivedInvitations.map((received) => received.id),
          [invitation.id],
        )

        await harness.repository.acceptWorkspaceInvitation(
          inviteeSession,
          invitation.id,
        )

        const inviteeSharedSession = await harness.resolveActorSession({
          userId: inviteeSession.actorUserId,
          workspaceId: sharedWorkspace.id,
        })

        assert.equal(inviteeSharedSession.role, 'user')
        assert.equal(inviteeSharedSession.groupRole, 'senior_member')

        const workspaceUsers =
          await harness.repository.listWorkspaceUsers(ownerSharedSession)
        const inviteeUser = workspaceUsers.find(
          (user) => user.id === inviteeSession.actorUserId,
        )
        const ownerUser = workspaceUsers.find((user) => user.isOwner)

        assert.ok(inviteeUser)
        assert.ok(ownerUser)
        assert.equal(inviteeUser.groupRole, 'senior_member')

        await assert.rejects(
          async () => {
            await harness.repository.updateSharedWorkspace(
              inviteeSharedSession,
              {
                name: 'Forbidden Rename',
              },
            )
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'shared_workspace_creator_required'),
        )
        await assert.rejects(
          async () => {
            await harness.repository.createWorkspaceInvitation(
              ownerSharedSession,
              {
                email: inviteeEmail,
                groupRole: 'member',
              },
            )
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'workspace_user_already_exists'),
        )
        await assert.rejects(
          async () => {
            await harness.repository.updateWorkspaceUserGroupRole(
              ownerSharedSession,
              ownerUser.membershipId,
              'member',
            )
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'workspace_owner_group_role_immutable'),
        )
        await assert.rejects(
          async () => {
            await harness.repository.updateWorkspaceUserGroupRole(
              inviteeSharedSession,
              inviteeUser.membershipId,
              'member',
            )
          },
          (error: unknown) =>
            hasHttpErrorCode(
              error,
              'workspace_self_group_role_change_forbidden',
            ),
        )
        await assert.rejects(
          async () => {
            await harness.repository.removeWorkspaceUser(
              ownerSharedSession,
              ownerUser.membershipId,
            )
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'workspace_owner_removal_forbidden'),
        )
        await assert.rejects(
          async () => {
            await harness.repository.leaveSharedWorkspace(ownerSharedSession)
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'workspace_owner_leave_forbidden'),
        )

        const updatedUser =
          await harness.repository.updateWorkspaceUserGroupRole(
            ownerSharedSession,
            inviteeUser.membershipId,
            'member',
          )

        assert.equal(updatedUser.groupRole, 'member')

        await harness.repository.removeWorkspaceUser(
          ownerSharedSession,
          inviteeUser.membershipId,
        )

        const workspaceUsersAfterRemoval =
          await harness.repository.listWorkspaceUsers(ownerSharedSession)

        assert.equal(
          workspaceUsersAfterRemoval.some(
            (user) => user.id === inviteeSession.actorUserId,
          ),
          false,
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps workspace invitation revocation and declined states consistent', async () => {
      const harness = await input.createHarness()

      try {
        const sharedWorkspace = await harness.repository.createSharedWorkspace(
          harness.ownerSession,
          {
            name: 'Contract Revocation Workspace',
          },
        )
        const ownerSharedSession = await harness.resolveActorSession({
          userId: harness.ownerSession.actorUserId,
          workspaceId: sharedWorkspace.id,
        })
        const inviteeUserId = randomUUID()
        const inviteeEmail = `contract-revoked-${inviteeUserId}@example.test`
        const invitation = await harness.repository.createWorkspaceInvitation(
          ownerSharedSession,
          {
            email: inviteeEmail,
            groupRole: 'member',
          },
        )
        const inviteeSession = await harness.createAuthenticatedSession({
          email: inviteeEmail,
          userId: inviteeUserId,
        })

        assert.deepEqual(
          (
            await harness.repository.listWorkspaceInvitations(
              ownerSharedSession,
            )
          ).map((candidate) => candidate.id),
          [invitation.id],
        )

        await harness.repository.revokeWorkspaceInvitation(
          ownerSharedSession,
          invitation.id,
        )

        assert.deepEqual(
          await harness.repository.listReceivedWorkspaceInvitations(
            inviteeSession,
          ),
          [],
        )
        await assert.rejects(
          async () => {
            await harness.repository.acceptWorkspaceInvitation(
              inviteeSession,
              invitation.id,
            )
          },
          (error: unknown) =>
            hasHttpErrorCode(error, 'workspace_invitation_not_found'),
        )

        const declinedInvitation =
          await harness.repository.createWorkspaceInvitation(
            ownerSharedSession,
            {
              email: inviteeEmail,
              groupRole: 'member',
            },
          )

        await harness.repository.declineWorkspaceInvitation(
          inviteeSession,
          declinedInvitation.id,
        )

        assert.deepEqual(
          await harness.repository.listReceivedWorkspaceInvitations(
            inviteeSession,
          ),
          [],
        )
      } finally {
        await harness.cleanup()
      }
    })

    void test('keeps admin user role updates consistent', async () => {
      const harness = await input.createHarness()

      try {
        const users = await harness.repository.listAdminUsers(
          harness.ownerSession,
        )

        assert.ok(
          users.some((user) => user.id === harness.memberSession.actorUserId),
        )

        const testUser = await harness.repository.updateAdminUserRole(
          harness.ownerSession,
          null,
          harness.memberSession.actorUserId,
          'test',
        )

        assert.equal(testUser.appRole, 'test')

        const updatedUser = await harness.repository.updateAdminUserRole(
          harness.ownerSession,
          null,
          harness.memberSession.actorUserId,
          'admin',
        )

        assert.equal(updatedUser.appRole, 'admin')

        await assert.rejects(
          async () => {
            await harness.repository.updateAdminUserRole(
              harness.ownerSession,
              null,
              harness.immutableOwnerUserId,
              'user',
            )
          },
          (error: unknown) => hasHttpErrorCode(error, 'owner_role_immutable'),
        )
      } finally {
        await harness.cleanup()
      }
    })
  })
}

export function createSessionAuthContext(input: {
  email: string
  userId: string
}): AuthenticatedRequestContext {
  return {
    accessToken: `contract-token-${input.userId}`,
    claims: {
      email: input.email,
      payload: {
        email: input.email,
      },
      role: 'authenticated',
      sub: input.userId,
    },
  }
}

export function createAuthenticatedSessionContext(input: {
  email: string
  userId: string
  workspaceId?: string | undefined
}): SessionContext {
  return {
    actorUserId: undefined,
    auth: createSessionAuthContext(input),
    workspaceId: input.workspaceId,
  }
}

function hasHttpErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  )
}
