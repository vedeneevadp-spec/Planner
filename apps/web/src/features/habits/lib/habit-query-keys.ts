export function habitsQueryKey(workspaceId: string) {
  return ['habits', workspaceId] as const
}

export function habitsTodayQueryKey(workspaceId: string, date: string) {
  return ['habits', workspaceId, 'today', date] as const
}

export function habitStatsQueryKey(
  workspaceId: string,
  from: string,
  to: string,
) {
  return ['habits', workspaceId, 'stats', from, to] as const
}

export function habitOfflineStatusQueryKey(
  workspaceId: string,
  actorUserId?: string,
) {
  return [
    'habits',
    workspaceId,
    'offline-status',
    actorUserId ?? 'pending',
  ] as const
}
