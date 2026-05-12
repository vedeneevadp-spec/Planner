import type {
  AppRole,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'

import {
  type AuthenticatedRequestContext,
  getRequestAuth,
} from './request-auth.js'
import { parseOrThrow } from './validation.js'

export const routeReadHeadersSchema = z.object({
  'x-workspace-id': z.string().min(1),
})

export const routeWriteHeadersSchema = routeReadHeadersSchema.extend({
  'x-actor-user-id': z.string().min(1),
})

export type RouteReadHeaders = z.infer<typeof routeReadHeadersSchema>
export type RouteWriteHeaders = z.infer<typeof routeWriteHeadersSchema>

interface RouteSessionService {
  resolveSession(input: {
    actorUserId: string | undefined
    auth: AuthenticatedRequestContext | null
    workspaceId: string
  }): Promise<{
    appRole: AppRole
    actor: {
      displayName: string
    }
    actorUserId: string
    groupRole: WorkspaceGroupRole | null
    role: WorkspaceRole
    workspace: {
      kind: WorkspaceKind
    }
    workspaceId: string
  }>
}

export function parseRouteReadHeaders(
  request: FastifyRequest,
): RouteReadHeaders {
  return parseOrThrow(
    routeReadHeadersSchema,
    request.headers,
    'invalid_headers',
  )
}

export function parseRouteWriteHeaders(
  request: FastifyRequest,
): RouteReadHeaders | RouteWriteHeaders {
  const authContext = getRequestAuth(request)

  return parseOrThrow(
    authContext ? routeReadHeadersSchema : routeWriteHeadersSchema,
    request.headers,
    'invalid_headers',
  )
}

export async function resolveRouteReadContext(
  request: FastifyRequest,
  sessionService: RouteSessionService,
) {
  const headers = parseRouteReadHeaders(request)
  const authContext = getRequestAuth(request)

  if (!authContext) {
    return {
      appRole: undefined,
      actorUserId: undefined,
      auth: null,
      role: undefined,
      workspaceId: headers['x-workspace-id'],
    }
  }

  const session = await sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: headers['x-workspace-id'],
  })

  return {
    appRole: session.appRole,
    actorUserId: session.actorUserId,
    auth: authContext,
    groupRole: session.groupRole,
    role: session.role,
    workspaceKind: session.workspace.kind,
    workspaceId: session.workspaceId,
  }
}

export async function resolveRouteWriteContext(
  request: FastifyRequest,
  sessionService: RouteSessionService,
) {
  const headers = parseRouteWriteHeaders(request)
  const authContext = getRequestAuth(request)

  if (!authContext) {
    const legacyHeaders = headers as RouteWriteHeaders
    const session = await sessionService.resolveSession({
      actorUserId: legacyHeaders['x-actor-user-id'],
      auth: null,
      workspaceId: legacyHeaders['x-workspace-id'],
    })

    return {
      appRole: undefined,
      actorDisplayName: session.actor.displayName,
      actorUserId: session.actorUserId,
      auth: null,
      groupRole: session.groupRole,
      role: session.role,
      workspaceKind: session.workspace.kind,
      workspaceId: session.workspaceId,
    }
  }

  const session = await sessionService.resolveSession({
    actorUserId: undefined,
    auth: authContext,
    workspaceId: headers['x-workspace-id'],
  })

  return {
    appRole: session.appRole,
    actorDisplayName: session.actor.displayName,
    actorUserId: session.actorUserId,
    auth: authContext,
    groupRole: session.groupRole,
    role: session.role,
    workspaceKind: session.workspace.kind,
    workspaceId: session.workspaceId,
  }
}

export function resolveRouteTokenReadContext(request: FastifyRequest) {
  const headers = parseRouteReadHeaders(request)
  const authContext = getRequestAuth(request)

  return {
    appRole: undefined,
    actorUserId: authContext?.claims.sub,
    auth: authContext,
    workspaceId: headers['x-workspace-id'],
  }
}
