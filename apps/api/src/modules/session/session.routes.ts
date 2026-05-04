import {
  adminUserListResponseSchema,
  adminUserRecordSchema,
  adminUserRoleUpdateInputSchema,
  createSharedWorkspaceInputSchema,
  sessionResponseSchema,
  sessionWorkspaceMembershipSchema,
  updateSharedWorkspaceInputSchema,
  workspaceInvitationCreateInputSchema,
  workspaceInvitationListResponseSchema,
  workspaceInvitationRecordSchema,
  workspaceSettingsSchema,
  workspaceSettingsUpdateInputSchema,
  workspaceUserGroupRoleUpdateInputSchema,
  workspaceUserListResponseSchema,
  workspaceUserRecordSchema,
} from '@planner/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import { getRequestAuth } from '../../bootstrap/request-auth.js'
import { parseOrThrow } from '../../bootstrap/validation.js'
import type { SessionService } from './session.service.js'

const legacySessionHeadersSchema = z.object({
  'x-actor-user-id': z.string().min(1).optional(),
  'x-workspace-id': z.string().min(1).optional(),
})

const authSessionHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1).optional(),
})

const requiredSessionAuthHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

const requiredSessionLegacyHeadersSchema =
  requiredSessionAuthHeadersSchema.extend({
    'x-actor-user-id': z.string().min(1),
  })

const userParamsSchema = z.object({
  userId: z.string().min(1),
})

const membershipParamsSchema = z.object({
  membershipId: z.string().min(1),
})

const invitationParamsSchema = z.object({
  invitationId: z.string().min(1),
})

export function registerSessionRoutes(
  app: FastifyInstance,
  service: SessionService,
): void {
  app.get('/api/v1/session', async (request) => {
    const context = resolveOptionalSessionContext(request)
    const session = await service.resolveSession(context)

    return sessionResponseSchema.parse(session)
  })

  app.post('/api/v1/workspaces/shared', async (request, reply) => {
    const context = resolveOptionalSessionContext(request)
    const input = parseOrThrow(
      createSharedWorkspaceInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const workspace = await service.createSharedWorkspace(context, input)

    reply.code(201)

    return sessionWorkspaceMembershipSchema.parse(workspace)
  })

  app.patch('/api/v1/workspaces/shared', async (request) => {
    const context = resolveRequiredSessionContext(request)
    const input = parseOrThrow(
      updateSharedWorkspaceInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const workspace = await service.updateSharedWorkspace(context, input)

    return sessionWorkspaceMembershipSchema.parse(workspace)
  })

  app.delete('/api/v1/workspaces/shared', async (request, reply) => {
    const context = resolveRequiredSessionContext(request)

    await service.deleteSharedWorkspace(context)

    return reply.code(204).send()
  })

  app.get('/api/v1/admin/users', async (request) => {
    const context = resolveRequiredSessionContext(request)
    const users = await service.listAdminUsers(context)

    return adminUserListResponseSchema.parse({ users })
  })

  app.patch('/api/v1/admin/users/:userId/role', async (request) => {
    const context = resolveRequiredSessionContext(request)
    const params = parseOrThrow(
      userParamsSchema,
      request.params,
      'invalid_params',
    )
    const input = parseOrThrow(
      adminUserRoleUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const user = await service.updateAdminUserRole(
      context,
      params.userId,
      input.role,
    )

    return adminUserRecordSchema.parse(user)
  })

  app.patch('/api/v1/admin/workspace-settings', async (request) => {
    const context = resolveRequiredSessionContext(request)
    const input = parseOrThrow(
      workspaceSettingsUpdateInputSchema,
      request.body,
      'invalid_body',
    )
    const settings = await service.updateWorkspaceSettings(context, input)

    return workspaceSettingsSchema.parse(settings)
  })

  app.get('/api/v1/workspace-users', async (request) => {
    const context = resolveRequiredSessionContext(request)
    const users = await service.listWorkspaceUsers(context)

    return workspaceUserListResponseSchema.parse({ users })
  })

  app.patch(
    '/api/v1/workspace-users/:membershipId/group-role',
    async (request) => {
      const context = resolveRequiredSessionContext(request)
      const params = parseOrThrow(
        membershipParamsSchema,
        request.params,
        'invalid_params',
      )
      const input = parseOrThrow(
        workspaceUserGroupRoleUpdateInputSchema,
        request.body,
        'invalid_body',
      )
      const user = await service.updateWorkspaceUserGroupRole(
        context,
        params.membershipId,
        input.groupRole,
      )

      return workspaceUserRecordSchema.parse(user)
    },
  )

  app.delete(
    '/api/v1/workspace-users/:membershipId',
    async (request, reply) => {
      const context = resolveRequiredSessionContext(request)
      const params = parseOrThrow(
        membershipParamsSchema,
        request.params,
        'invalid_params',
      )

      await service.removeWorkspaceUser(context, params.membershipId)

      return reply.code(204).send()
    },
  )

  app.get('/api/v1/workspace-invitations', async (request) => {
    const context = resolveRequiredSessionContext(request)
    const invitations = await service.listWorkspaceInvitations(context)

    return workspaceInvitationListResponseSchema.parse({ invitations })
  })

  app.post('/api/v1/workspace-invitations', async (request, reply) => {
    const context = resolveRequiredSessionContext(request)
    const input = parseOrThrow(
      workspaceInvitationCreateInputSchema,
      request.body ?? {},
      'invalid_body',
    )
    const invitation = await service.createWorkspaceInvitation(context, input)

    reply.code(201)

    return workspaceInvitationRecordSchema.parse(invitation)
  })

  app.delete(
    '/api/v1/workspace-invitations/:invitationId',
    async (request, reply) => {
      const context = resolveRequiredSessionContext(request)
      const params = parseOrThrow(
        invitationParamsSchema,
        request.params,
        'invalid_params',
      )

      await service.revokeWorkspaceInvitation(context, params.invitationId)

      return reply.code(204).send()
    },
  )
}

function resolveOptionalSessionContext(request: FastifyRequest) {
  const authContext = getRequestAuth(request)

  if (authContext) {
    const headers = parseOrThrow(
      authSessionHeadersSchema,
      request.headers,
      'invalid_headers',
    )

    return {
      actorUserId: undefined,
      auth: authContext,
      workspaceId: headers['x-workspace-id'],
    }
  }

  const headers = parseOrThrow(
    legacySessionHeadersSchema,
    request.headers,
    'invalid_headers',
  )

  if (
    Boolean(headers['x-actor-user-id']) !== Boolean(headers['x-workspace-id'])
  ) {
    throw new HttpError(
      400,
      'invalid_headers',
      'x-actor-user-id and x-workspace-id must be provided together.',
    )
  }

  return {
    actorUserId: headers['x-actor-user-id'],
    auth: null,
    workspaceId: headers['x-workspace-id'],
  }
}

function resolveRequiredSessionContext(request: FastifyRequest) {
  const authContext = getRequestAuth(request)

  if (authContext) {
    const headers = parseOrThrow(
      requiredSessionAuthHeadersSchema,
      request.headers,
      'invalid_headers',
    )

    return {
      actorUserId: undefined,
      auth: authContext,
      workspaceId: headers['x-workspace-id'],
    }
  }

  const headers = parseOrThrow(
    requiredSessionLegacyHeadersSchema,
    request.headers,
    'invalid_headers',
  )

  return {
    actorUserId: headers['x-actor-user-id'],
    auth: null,
    workspaceId: headers['x-workspace-id'],
  }
}
