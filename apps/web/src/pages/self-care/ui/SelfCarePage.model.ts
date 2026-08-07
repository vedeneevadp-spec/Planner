import {
  getSelfCareAnalyticsDetailSelection,
  getSelfCareCreateDialogMode,
  getSelfCareTab,
  SELF_CARE_ACTION_REQUEST_SEARCH_PARAM,
  SELF_CARE_ACTION_SEARCH_PARAM,
  SELF_CARE_ANALYTICS_ITEM_SEARCH_PARAM,
  SELF_CARE_ANALYTICS_TYPE_SEARCH_PARAM,
  type SelfCareAnalyticsDetailSelection,
  type SelfCareCreateDialogMode,
  type SelfCareTab,
} from './SelfCarePage.helpers'

export interface SelfCarePageRouteState {
  activeTab: SelfCareTab
  analyticsDetailSelection: SelfCareAnalyticsDetailSelection | null
  createDialogMode: SelfCareCreateDialogMode | null
}

export interface SelfCarePageLoadFlags {
  analytics: boolean
  dashboard: boolean
  history: boolean
  items: boolean
  plan: boolean
  ritualStepDrafts: boolean
  settings: boolean
  templates: boolean
}

export type SelfCarePageReadScope = keyof SelfCarePageLoadFlags

export function getSelfCarePageRouteState(
  searchParams: URLSearchParams,
): SelfCarePageRouteState {
  return {
    activeTab: getSelfCareTab(searchParams),
    analyticsDetailSelection: getSelfCareAnalyticsDetailSelection(searchParams),
    createDialogMode: getSelfCareCreateDialogMode(searchParams),
  }
}

export function getSelfCarePageLoadFlags(
  routeState: SelfCarePageRouteState,
): SelfCarePageLoadFlags {
  const { activeTab, createDialogMode } = routeState
  const isCreateDialogOpen = Boolean(createDialogMode)

  return {
    analytics: activeTab === 'analytics',
    dashboard: activeTab === 'today' || activeTab === 'rituals',
    history:
      activeTab === 'today' ||
      activeTab === 'plan' ||
      activeTab === 'rituals' ||
      activeTab === 'history',
    items:
      activeTab === 'today' ||
      activeTab === 'rituals' ||
      activeTab === 'settings' ||
      isCreateDialogOpen,
    plan:
      activeTab === 'today' || activeTab === 'plan' || activeTab === 'rituals',
    ritualStepDrafts: activeTab === 'today' || activeTab === 'rituals',
    settings: activeTab === 'settings' || isCreateDialogOpen,
    templates: activeTab === 'settings' || isCreateDialogOpen,
  }
}

export function getSelfCareActiveTabReadScopes(
  activeTab: SelfCareTab,
): readonly SelfCarePageReadScope[] {
  switch (activeTab) {
    case 'today':
    case 'rituals':
      return ['dashboard', 'items', 'plan', 'history', 'ritualStepDrafts']

    case 'plan':
      return ['plan', 'history']

    case 'history':
      return ['history']

    case 'analytics':
      return ['analytics']

    case 'settings':
      return ['settings', 'items', 'templates']
  }
}

export function getSelfCareActiveTabCoreReadScope(
  activeTab: SelfCareTab,
): SelfCarePageReadScope {
  switch (activeTab) {
    case 'today':
      return 'dashboard'
    case 'rituals':
      return 'items'
    case 'plan':
      return 'plan'
    case 'history':
      return 'history'
    case 'analytics':
      return 'analytics'
    case 'settings':
      return 'settings'
  }
}

export function getSelfCareActiveTabReadValues<
  TValues extends Readonly<Record<SelfCarePageReadScope, unknown>>,
>(
  activeTab: SelfCareTab,
  valuesByScope: TValues,
): Array<TValues[SelfCarePageReadScope]> {
  return getSelfCareActiveTabReadScopes(activeTab).map(
    (scope) => valuesByScope[scope],
  )
}

export function getSelfCareTabSearchParams(
  searchParams: URLSearchParams,
  tab: SelfCareTab,
): URLSearchParams {
  const next = new URLSearchParams(searchParams)

  if (tab === 'today') {
    next.delete('tab')
  } else {
    next.set('tab', tab)
  }

  if (tab !== 'analytics') {
    next.delete(SELF_CARE_ANALYTICS_ITEM_SEARCH_PARAM)
    next.delete(SELF_CARE_ANALYTICS_TYPE_SEARCH_PARAM)
  }

  return next
}

export function getSelfCareAnalyticsDetailSearchParams(
  searchParams: URLSearchParams,
  selection: SelfCareAnalyticsDetailSelection,
): URLSearchParams {
  const next = getSelfCareTabSearchParams(searchParams, 'analytics')

  next.set(SELF_CARE_ANALYTICS_TYPE_SEARCH_PARAM, selection.kind)
  next.set(SELF_CARE_ANALYTICS_ITEM_SEARCH_PARAM, selection.itemId)

  return next
}

export function getSelfCareAnalyticsOverviewSearchParams(
  searchParams: URLSearchParams,
): URLSearchParams {
  const next = getSelfCareTabSearchParams(searchParams, 'analytics')

  next.delete(SELF_CARE_ANALYTICS_ITEM_SEARCH_PARAM)
  next.delete(SELF_CARE_ANALYTICS_TYPE_SEARCH_PARAM)

  return next
}

export function getSelfCareCloseCreateDialogSearchParams(
  searchParams: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(searchParams)

  next.delete(SELF_CARE_ACTION_SEARCH_PARAM)
  next.delete(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM)

  return next
}

export function getSelfCareCloseCreateDialogAndTabSearchParams(
  searchParams: URLSearchParams,
  tab: SelfCareTab,
): URLSearchParams {
  return getSelfCareTabSearchParams(
    getSelfCareCloseCreateDialogSearchParams(searchParams),
    tab,
  )
}

export function getSelfCareCreateDialogSearchParams(
  searchParams: URLSearchParams,
  mode: SelfCareCreateDialogMode,
): URLSearchParams {
  const next = new URLSearchParams(searchParams)

  next.set(SELF_CARE_ACTION_SEARCH_PARAM, 'care')
  next.set(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM, mode)

  return next
}
