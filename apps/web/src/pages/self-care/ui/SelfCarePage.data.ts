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
  getSelfCareActiveTabCoreReadScope,
  getSelfCareActiveTabReadValues,
  getSelfCarePageLoadFlags,
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
  // Start the widest occurrence range first. The API coalesces the overlapping
  // dashboard generation into this range, avoiding duplicate write work.
  const planQuery = useSelfCarePlan(todayKey, planTo, {
    enabled: loadFlags.plan,
  })
  const dashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: loadFlags.dashboard,
  })
  const itemsQuery = useSelfCareItems({ enabled: loadFlags.items })
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
  const queryByScope = {
    analytics: analyticsQuery,
    dashboard: dashboardQuery,
    history: historyQuery,
    items: itemsQuery,
    plan: planQuery,
    ritualStepDrafts: stepDraftsQuery,
    settings: settingsQuery,
    templates: templatesQuery,
  }
  const activeTabQueries = getSelfCareActiveTabReadValues(
    routeState.activeTab,
    queryByScope,
  )
  const activeTabCoreQuery =
    queryByScope[getSelfCareActiveTabCoreReadScope(routeState.activeTab)]
  const createDialogQueries = [itemsQuery, settingsQuery, templatesQuery]
  const createDialogRequiredQueries =
    routeState.createDialogMode === 'template'
      ? createDialogQueries
      : [itemsQuery, settingsQuery]
  const visibleQueries = routeState.createDialogMode
    ? Array.from(new Set([...activeTabQueries, ...createDialogQueries]))
    : activeTabQueries
  const activeTabReadErrors = activeTabQueries
    .map((query) => query.error)
    .filter((error): error is Error => Boolean(error))
  const createDialogReadErrors = createDialogRequiredQueries
    .map((query) => query.error)
    .filter((error): error is Error => Boolean(error))
  const isActiveTabLoading =
    activeTabCoreQuery.data === undefined && activeTabCoreQuery.isLoading
  const isActiveTabCacheLoading =
    activeTabCoreQuery.data === undefined && activeTabCoreQuery.isCacheLoading
  const hasActiveTabData = activeTabCoreQuery.data !== undefined
  const hasCompleteActiveTabData = activeTabQueries.every(
    (query) => query.data !== undefined,
  )
  const activeTabLastSyncTimes = activeTabQueries
    .map((query) => query.lastSuccessfulSyncAt)
    .filter((value): value is string => Boolean(value))
  const lastSuccessfulSyncAt = activeTabLastSyncTimes.sort()[0] ?? null
  const retryActiveTab = async () => {
    await Promise.allSettled(visibleQueries.map((query) => query.refetch()))
  }
  const isCreateDialogLoading = Boolean(
    routeState.createDialogMode &&
    createDialogRequiredQueries.some(
      (query) =>
        query.data === undefined && (query.isLoading || query.isCacheLoading),
    ),
  )
  const hasCreateDialogData = createDialogRequiredQueries.every(
    (query) => query.data !== undefined,
  )
  const serverRitualStepDrafts = useMemo(
    () =>
      stepDraftsQuery.data ? buildRitualStepDraftMap(stepDraftsQuery.data) : {},
    [stepDraftsQuery.data],
  )
  const createdTemplateIds = useMemo(() => getCreatedTemplateIds(list), [list])

  return {
    analytics,
    analyticsQuery,
    activeTabReadErrors,
    createdTemplateIds,
    createDialogReadErrors,
    dashboard,
    dashboardQuery,
    defaultCurrency,
    history,
    historyQuery,
    hasActiveTabData,
    hasCompleteActiveTabData,
    hasCreateDialogReadError: createDialogReadErrors.length > 0,
    hasCreateDialogData,
    isActiveTabCacheLoading,
    isActiveTabLoading,
    isCreateDialogLoading,
    itemsQuery,
    list,
    lastSuccessfulSyncAt,
    plan,
    planQuery,
    retryActiveTab,
    serverRitualStepDrafts,
    settingsQuery,
    settingsResponse,
    stepDraftsQuery,
    templates,
    templatesLoaded: templatesQuery.data !== undefined,
    templatesQuery,
    todayKey,
    uploadedIcons,
  }
}
