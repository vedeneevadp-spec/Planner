type WorkspaceKind = 'personal' | 'shared'

export type AppRouteId =
  | 'admin'
  | 'calendar'
  | 'cleaning'
  | 'cleaningSettings'
  | 'cleaningSettingsZone'
  | 'cleaningZoneRedirect'
  | 'habits'
  | 'more'
  | 'profile'
  | 'shopping'
  | 'sphere'
  | 'spheres'
  | 'today'
  | 'voiceAssistantSettings'

export interface AppRouteDefinition {
  id: AppRouteId
  path: string
  workspaceKinds: readonly WorkspaceKind[]
}

export type NavigationRouteId =
  | 'admin'
  | 'calendar'
  | 'cleaning'
  | 'habits'
  | 'shopping'
  | 'spheres'
  | 'today'

export type PlannerTabColor =
  | 'blue'
  | 'gray'
  | 'green'
  | 'lavender'
  | 'mint'
  | 'peach'
  | 'pink'

export interface NavigationRouteDefinition extends AppRouteDefinition {
  id: NavigationRouteId
  label: string
  mobileOrder?: number
  mobilePlacement?: 'more' | 'primary'
  plannerTabColor?: PlannerTabColor
  plannerTabOrder?: number
  plannerTabPlacement?: 'more' | 'side'
  plannerTabShortLabel?: string
  to: string
}

const allWorkspaceKinds = ['personal', 'shared'] as const
const personalOnlyWorkspaceKinds = ['personal'] as const

export const appRouteDefinitions = [
  {
    id: 'today',
    path: '/today',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'calendar',
    path: '/calendar',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'cleaning',
    path: '/cleaning',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'cleaningSettings',
    path: '/cleaning/settings',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'cleaningSettingsZone',
    path: '/cleaning/settings/zones/:zoneId',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'cleaningZoneRedirect',
    path: '/cleaning/zones/:zoneId',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'shopping',
    path: '/shopping',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'spheres',
    path: '/spheres',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'sphere',
    path: '/spheres/:sphereId',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'habits',
    path: '/habits',
    workspaceKinds: personalOnlyWorkspaceKinds,
  },
  {
    id: 'more',
    path: '/more',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'voiceAssistantSettings',
    path: '/voice-assistant/settings',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'profile',
    path: '/profile',
    workspaceKinds: personalOnlyWorkspaceKinds,
  },
  {
    id: 'admin',
    path: '/admin',
    workspaceKinds: personalOnlyWorkspaceKinds,
  },
] as const satisfies readonly AppRouteDefinition[]

export const navigationRouteDefinitions = [
  {
    id: 'today',
    label: 'Сегодня',
    mobileOrder: 0,
    mobilePlacement: 'primary',
    plannerTabColor: 'pink',
    plannerTabOrder: 0,
    plannerTabPlacement: 'side',
    plannerTabShortLabel: 'Сегодня',
    path: '/today',
    to: '/today',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'calendar',
    label: 'Календарь',
    mobileOrder: 1,
    mobilePlacement: 'primary',
    plannerTabColor: 'peach',
    plannerTabOrder: 1,
    plannerTabPlacement: 'side',
    plannerTabShortLabel: 'Календарь',
    path: '/calendar',
    to: '/calendar',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'shopping',
    label: 'Покупки',
    mobileOrder: 2,
    mobilePlacement: 'primary',
    plannerTabColor: 'blue',
    plannerTabOrder: 2,
    plannerTabPlacement: 'side',
    plannerTabShortLabel: 'Покупки',
    path: '/shopping',
    to: '/shopping',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'cleaning',
    label: 'Уборка',
    mobileOrder: 3,
    mobilePlacement: 'primary',
    plannerTabColor: 'mint',
    plannerTabOrder: 3,
    plannerTabPlacement: 'side',
    plannerTabShortLabel: 'Уборка',
    path: '/cleaning',
    to: '/cleaning',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'spheres',
    label: 'Сферы',
    mobileOrder: 0,
    mobilePlacement: 'more',
    plannerTabColor: 'green',
    plannerTabOrder: 4,
    plannerTabPlacement: 'side',
    plannerTabShortLabel: 'Сферы',
    path: '/spheres',
    to: '/spheres',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'habits',
    label: 'Привычки',
    mobileOrder: 1,
    mobilePlacement: 'more',
    plannerTabColor: 'pink',
    plannerTabOrder: 5,
    plannerTabPlacement: 'side',
    plannerTabShortLabel: 'Привычки',
    path: '/habits',
    to: '/habits',
    workspaceKinds: personalOnlyWorkspaceKinds,
  },
  {
    id: 'admin',
    label: 'Admin',
    mobileOrder: 2,
    mobilePlacement: 'more',
    plannerTabColor: 'gray',
    plannerTabPlacement: 'more',
    path: '/admin',
    to: '/admin',
    workspaceKinds: personalOnlyWorkspaceKinds,
  },
] as const satisfies readonly NavigationRouteDefinition[]

export function getVisibleAppRouteDefinitions(
  workspaceKind: WorkspaceKind,
): AppRouteDefinition[] {
  return appRouteDefinitions.filter((route) =>
    route.workspaceKinds.some((candidate) => candidate === workspaceKind),
  )
}

export function getVisibleNavigationRouteDefinitions(
  workspaceKind: WorkspaceKind,
): NavigationRouteDefinition[] {
  return navigationRouteDefinitions.filter((route) =>
    route.workspaceKinds.some((candidate) => candidate === workspaceKind),
  )
}
