import { useMemo } from 'react'

import { useUploadedIconAssets } from '@/features/emoji-library'
import {
  useSelfCareAnalytics,
  useSelfCareDashboard,
  useSelfCareHistory,
  useSelfCareItems,
  useSelfCarePlan,
  useSelfCareRitualStepDrafts,
  useSelfCareSettings,
  useSelfCareTemplates,
} from '@/features/self-care'
import { usePlannerTimeZone } from '@/features/session'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import {
  buildRitualStepDraftMap,
  getCreatedTemplateIds,
  isVisibleSelfCareTemplate,
  SELF_CARE_PLAN_LOOKAHEAD_DAYS,
} from './SelfCarePage.helpers'
import {
  getSelfCarePageLoadFlags,
  isSelfCareActiveTabLoading,
  type SelfCarePageRouteState,
} from './SelfCarePage.model'

const SELF_CARE_ANALYTICS_FULL_RANGE_FROM = '1970-01-01'

export function useSelfCarePageData(routeState: SelfCarePageRouteState) {
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const rangeFrom = addDateDays(todayKey, -30)
  const analyticsRangeFrom = routeState.analyticsDetailSelection
    ? SELF_CARE_ANALYTICS_FULL_RANGE_FROM
    : rangeFrom
  const planTo = addDateDays(todayKey, SELF_CARE_PLAN_LOOKAHEAD_DAYS)
  const loadFlags = getSelfCarePageLoadFlags(routeState)
  const { uploadedIcons } = useUploadedIconAssets()
  const dashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: loadFlags.dashboard,
  })
  const itemsQuery = useSelfCareItems({ enabled: loadFlags.items })
  const planQuery = useSelfCarePlan(todayKey, planTo, {
    enabled: loadFlags.plan,
  })
  const stepDraftsQuery = useSelfCareRitualStepDrafts(todayKey, {
    enabled: loadFlags.ritualStepDrafts,
  })
  const historyQuery = useSelfCareHistory(rangeFrom, todayKey, {
    enabled: loadFlags.history,
  })
  const analyticsQuery = useSelfCareAnalytics(analyticsRangeFrom, todayKey, {
    enabled: loadFlags.analytics,
  })
  const settingsQuery = useSelfCareSettings({ enabled: loadFlags.settings })
  const templatesQuery = useSelfCareTemplates({ enabled: loadFlags.templates })
  const dashboard = dashboardQuery.data
  const list = itemsQuery.data
  const plan = planQuery.data
  const history = historyQuery.data
  const analytics = analyticsQuery.data
  const settingsResponse =
    settingsQuery.data ??
    (dashboard ? { minimumItems: [], settings: dashboard.settings } : undefined)
  const defaultCurrency = settingsResponse?.settings.currency ?? 'RUB'
  const templates = useMemo(
    () => (templatesQuery.data ?? []).filter(isVisibleSelfCareTemplate),
    [templatesQuery.data],
  )
  const isActiveTabLoading = isSelfCareActiveTabLoading({
    activeTab: routeState.activeTab,
    hasAnalytics: Boolean(analytics),
    hasDashboard: Boolean(dashboard),
    hasHistory: Boolean(history),
    hasItems: Boolean(list),
    hasPlan: Boolean(plan),
    hasSettings: Boolean(settingsResponse),
    isAnalyticsLoading: analyticsQuery.isLoading,
    isDashboardLoading: dashboardQuery.isLoading,
    isHistoryLoading: historyQuery.isLoading,
    isItemsLoading: itemsQuery.isLoading,
    isPlanLoading: planQuery.isLoading,
    isSettingsLoading: settingsQuery.isLoading,
  })
  const serverRitualStepDrafts = useMemo(
    () =>
      stepDraftsQuery.data ? buildRitualStepDraftMap(stepDraftsQuery.data) : {},
    [stepDraftsQuery.data],
  )
  const createdTemplateIds = useMemo(() => getCreatedTemplateIds(list), [list])

  return {
    analytics,
    analyticsQuery,
    createdTemplateIds,
    dashboard,
    dashboardQuery,
    defaultCurrency,
    history,
    historyQuery,
    isActiveTabLoading,
    itemsQuery,
    list,
    plan,
    planQuery,
    serverRitualStepDrafts,
    settingsQuery,
    settingsResponse,
    stepDraftsQuery,
    templates,
    templatesQuery,
    todayKey,
    uploadedIcons,
  }
}
