import {
  getSelfCareCreateDialogMode,
  getSelfCareTab,
  SELF_CARE_ACTION_REQUEST_SEARCH_PARAM,
  SELF_CARE_ACTION_SEARCH_PARAM,
  type SelfCareCreateDialogMode,
  type SelfCareTab,
} from './SelfCarePage.helpers'

export interface SelfCarePageRouteState {
  activeTab: SelfCareTab
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

export interface SelfCareActiveTabLoadingInput {
  activeTab: SelfCareTab
  hasAnalytics: boolean
  hasDashboard: boolean
  hasHistory: boolean
  hasItems: boolean
  hasPlan: boolean
  hasSettings: boolean
  isAnalyticsLoading: boolean
  isDashboardLoading: boolean
  isHistoryLoading: boolean
  isItemsLoading: boolean
  isPlanLoading: boolean
  isSettingsLoading: boolean
}

export function getSelfCarePageRouteState(
  searchParams: URLSearchParams,
): SelfCarePageRouteState {
  return {
    activeTab: getSelfCareTab(searchParams),
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

export function isSelfCareActiveTabLoading(
  input: SelfCareActiveTabLoadingInput,
): boolean {
  return (
    (input.activeTab === 'today' &&
      input.isDashboardLoading &&
      !input.hasDashboard) ||
    (input.activeTab === 'plan' && input.isPlanLoading && !input.hasPlan) ||
    (input.activeTab === 'rituals' &&
      input.isItemsLoading &&
      !input.hasItems) ||
    (input.activeTab === 'history' &&
      input.isHistoryLoading &&
      !input.hasHistory) ||
    (input.activeTab === 'analytics' &&
      input.isAnalyticsLoading &&
      !input.hasAnalytics) ||
    (input.activeTab === 'settings' &&
      input.isSettingsLoading &&
      !input.hasSettings)
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
