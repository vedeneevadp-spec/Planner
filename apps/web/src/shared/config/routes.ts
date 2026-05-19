type WorkspaceKind = 'personal' | 'shared'

export type AppRouteId =
  | 'admin'
  | 'calendar'
  | 'cleaning'
  | 'cleaningSettings'
  | 'cleaningSettingsZone'
  | 'cleaningZoneRedirect'
  | 'habits'
  | 'profile'
  | 'shopping'
  | 'sphere'
  | 'spheres'
  | 'timeline'
  | 'today'

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
  | 'timeline'
  | 'today'

export interface NavigationRouteDefinition extends AppRouteDefinition {
  id: NavigationRouteId
  label: string
  mobileOrder?: number
  mobilePlacement?: 'more' | 'primary'
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
    id: 'timeline',
    path: '/timeline',
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
    path: '/today',
    to: '/today',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'calendar',
    label: 'Календарь',
    mobileOrder: 1,
    mobilePlacement: 'primary',
    path: '/calendar',
    to: '/calendar',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'shopping',
    label: 'Покупки',
    mobileOrder: 2,
    mobilePlacement: 'primary',
    path: '/shopping',
    to: '/shopping',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'cleaning',
    label: 'Уборка',
    mobileOrder: 3,
    mobilePlacement: 'primary',
    path: '/cleaning',
    to: '/cleaning',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'spheres',
    label: 'Сферы',
    mobileOrder: 1,
    mobilePlacement: 'more',
    path: '/spheres',
    to: '/spheres',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'habits',
    label: 'Привычки',
    mobileOrder: 2,
    mobilePlacement: 'more',
    path: '/habits',
    to: '/habits',
    workspaceKinds: personalOnlyWorkspaceKinds,
  },
  {
    id: 'timeline',
    label: 'Таймлайн',
    mobileOrder: 0,
    mobilePlacement: 'more',
    path: '/timeline',
    to: '/timeline',
    workspaceKinds: allWorkspaceKinds,
  },
  {
    id: 'admin',
    label: 'Admin',
    mobileOrder: 3,
    mobilePlacement: 'more',
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
