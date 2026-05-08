import type { SessionResponse } from '@planner/contracts'
import { sessionResponseSchema } from '@planner/contracts'

const PLANNER_SESSION_CACHE_STORAGE_KEY = 'planner.cachedSessions'

type PlannerSessionCacheMap = Record<string, SessionResponse>

export function getCachedPlannerSession(options: {
  actorUserId?: string | null | undefined
  workspaceId?: string | null | undefined
}): SessionResponse | null {
  const normalizedActorUserId = normalizeActorUserId(options.actorUserId)

  if (!normalizedActorUserId) {
    return null
  }

  const cachedSession = readCachedPlannerSessionMap()[normalizedActorUserId]

  if (!cachedSession) {
    return null
  }

  return resolveCachedWorkspaceSession(cachedSession, options.workspaceId)
}

export function setCachedPlannerSession(session: SessionResponse): void {
  const normalizedActorUserId = normalizeActorUserId(session.actorUserId)

  if (!normalizedActorUserId) {
    return
  }

  const nextCacheMap = readCachedPlannerSessionMap()
  nextCacheMap[normalizedActorUserId] = session
  writeCachedPlannerSessionMap(nextCacheMap)
}

export function clearCachedPlannerSession(actorUserId?: string | null): void {
  const normalizedActorUserId = normalizeActorUserId(actorUserId)

  if (!normalizedActorUserId) {
    removeStorageValue(PLANNER_SESSION_CACHE_STORAGE_KEY)
    return
  }

  const nextCacheMap = readCachedPlannerSessionMap()

  if (!(normalizedActorUserId in nextCacheMap)) {
    return
  }

  delete nextCacheMap[normalizedActorUserId]
  writeCachedPlannerSessionMap(nextCacheMap)
}

function resolveCachedWorkspaceSession(
  session: SessionResponse,
  workspaceId?: string | null,
): SessionResponse {
  const normalizedWorkspaceId = workspaceId?.trim() || null

  if (!normalizedWorkspaceId || normalizedWorkspaceId === session.workspaceId) {
    return session
  }

  const membership = session.workspaces.find(
    (workspace) => workspace.id === normalizedWorkspaceId,
  )

  if (!membership) {
    return session
  }

  return {
    ...session,
    groupRole: membership.groupRole,
    role: membership.role,
    workspace: {
      id: membership.id,
      kind: membership.kind,
      name: membership.name,
      slug: membership.slug,
    },
    workspaceId: membership.id,
  }
}

function normalizeActorUserId(actorUserId?: string | null): string | null {
  return actorUserId?.trim() || null
}

function readCachedPlannerSessionMap(): PlannerSessionCacheMap {
  const rawValue = readStorageValue(PLANNER_SESSION_CACHE_STORAGE_KEY)

  if (!rawValue) {
    return {}
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      Array.isArray(parsedValue)
    ) {
      return {}
    }

    const nextCacheMap: PlannerSessionCacheMap = {}

    for (const [actorUserId, sessionValue] of Object.entries(parsedValue)) {
      const normalizedActorUserId = normalizeActorUserId(actorUserId)

      if (!normalizedActorUserId) {
        continue
      }

      const parsedSession = sessionResponseSchema.safeParse(sessionValue)

      if (!parsedSession.success) {
        continue
      }

      nextCacheMap[normalizedActorUserId] = parsedSession.data
    }

    return nextCacheMap
  } catch {
    return {}
  }
}

function writeCachedPlannerSessionMap(map: PlannerSessionCacheMap): void {
  if (Object.keys(map).length === 0) {
    removeStorageValue(PLANNER_SESSION_CACHE_STORAGE_KEY)
    return
  }

  writeStorageValue(PLANNER_SESSION_CACHE_STORAGE_KEY, JSON.stringify(map))
}

function readStorageValue(key: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const value = window.localStorage.getItem(key)?.trim()

  return value || null
}

function writeStorageValue(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(key, value)
}

function removeStorageValue(key: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(key)
}
