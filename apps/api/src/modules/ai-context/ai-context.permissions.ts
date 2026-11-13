export const HAOTIKA_MCP_READ_SCOPES = [
  'haotika:tasks.read',
  'haotika:calendar.read',
  'haotika:shopping.read',
  'haotika:cleaning.read',
  'haotika:selfcare.read',
  'haotika:habits.read',
  'haotika:stats.read',
] as const

export const HAOTIKA_MCP_WRITE_SCOPES = [
  'haotika:tasks.write',
  'haotika:shopping.write',
] as const

export const HAOTIKA_MCP_SCOPES = [
  ...HAOTIKA_MCP_READ_SCOPES,
  ...HAOTIKA_MCP_WRITE_SCOPES,
] as const

export type HaotikaMcpScope = (typeof HAOTIKA_MCP_SCOPES)[number]

export const TODAY_CONTEXT_INCLUDE_KEYS = [
  'tasks',
  'calendar',
  'shopping',
  'cleaning',
  'selfcare',
  'habits',
  'stats',
] as const

export type TodayContextInclude = (typeof TODAY_CONTEXT_INCLUDE_KEYS)[number]

export const WEEK_CONTEXT_INCLUDE_KEYS = [
  'tasks',
  'calendar',
  'shopping',
  'cleaning',
  'selfcare',
  'stats',
] as const

export type WeekContextInclude = (typeof WEEK_CONTEXT_INCLUDE_KEYS)[number]

export function resolveWeekContextInclude(
  include?: readonly WeekContextInclude[],
): WeekContextInclude[] {
  return include?.length ? [...include] : [...WEEK_CONTEXT_INCLUDE_KEYS]
}

export const PLANNER_SEARCH_TYPES = [
  'tasks',
  'calendar',
  'shopping',
  'cleaning',
  'selfcare',
  'habits',
] as const

export type PlannerSearchType = (typeof PLANNER_SEARCH_TYPES)[number]

export function resolveTodayContextInclude(
  include?: readonly TodayContextInclude[],
): TodayContextInclude[] {
  return include?.length ? [...include] : [...TODAY_CONTEXT_INCLUDE_KEYS]
}

export function getScopesForInclude(
  include: readonly TodayContextInclude[],
): HaotikaMcpScope[] {
  const scopes = new Set<HaotikaMcpScope>()

  for (const key of include) {
    switch (key) {
      case 'calendar':
        scopes.add('haotika:calendar.read')
        break
      case 'cleaning':
        scopes.add('haotika:cleaning.read')
        break
      case 'habits':
        scopes.add('haotika:habits.read')
        break
      case 'selfcare':
        scopes.add('haotika:selfcare.read')
        break
      case 'shopping':
        scopes.add('haotika:shopping.read')
        break
      case 'stats':
        scopes.add('haotika:stats.read')
        break
      case 'tasks':
        scopes.add('haotika:tasks.read')
        break
    }
  }

  return [...scopes]
}

export function getScopesForSearchTypes(
  types: readonly PlannerSearchType[],
): HaotikaMcpScope[] {
  return getScopesForInclude(
    types.map((type) => (type === 'selfcare' ? 'selfcare' : type)),
  )
}
