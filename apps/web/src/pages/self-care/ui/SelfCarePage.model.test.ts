import { describe, expect, it } from 'vitest'

import {
  getSelfCareAnalyticsDetailSearchParams,
  getSelfCareAnalyticsOverviewSearchParams,
  getSelfCareCloseCreateDialogAndTabSearchParams,
  getSelfCareCloseCreateDialogSearchParams,
  getSelfCareCreateDialogSearchParams,
  getSelfCarePageLoadFlags,
  getSelfCarePageRouteState,
  getSelfCareTabSearchParams,
  isSelfCareActiveTabLoading,
  type SelfCareActiveTabLoadingInput,
} from './SelfCarePage.model'

describe('SelfCarePage model', () => {
  it('resolves active tab and create dialog mode from search params', () => {
    expect(
      getSelfCarePageRouteState(
        new URLSearchParams('tab=plan&selfCareAction=care'),
      ),
    ).toEqual({
      activeTab: 'plan',
      analyticsDetailSelection: null,
      createDialogMode: 'choice',
    })

    expect(
      getSelfCarePageRouteState(
        new URLSearchParams(
          'tab=unknown&selfCareAction=care&selfCareActionRequest=template',
        ),
      ),
    ).toEqual({
      activeTab: 'today',
      analyticsDetailSelection: null,
      createDialogMode: 'template',
    })

    expect(
      getSelfCarePageRouteState(
        new URLSearchParams(
          'tab=analytics&analyticsType=exercise&analyticsItemId=exercise-1',
        ),
      ),
    ).toEqual({
      activeTab: 'analytics',
      analyticsDetailSelection: {
        itemId: 'exercise-1',
        kind: 'exercise',
      },
      createDialogMode: null,
    })
  })

  it('loads only the data required by the active tab', () => {
    expect(
      getSelfCarePageLoadFlags({
        activeTab: 'today',
        analyticsDetailSelection: null,
        createDialogMode: null,
      }),
    ).toEqual({
      analytics: false,
      dashboard: true,
      history: true,
      items: true,
      plan: true,
      ritualStepDrafts: true,
      settings: false,
      templates: false,
    })

    expect(
      getSelfCarePageLoadFlags({
        activeTab: 'analytics',
        analyticsDetailSelection: {
          itemId: 'measurement-1',
          kind: 'measurement',
        },
        createDialogMode: null,
      }),
    ).toEqual({
      analytics: true,
      dashboard: false,
      history: false,
      items: false,
      plan: false,
      ritualStepDrafts: false,
      settings: false,
      templates: false,
    })
  })

  it('loads creation dependencies while the create dialog is open', () => {
    expect(
      getSelfCarePageLoadFlags({
        activeTab: 'history',
        analyticsDetailSelection: null,
        createDialogMode: 'custom',
      }),
    ).toEqual({
      analytics: false,
      dashboard: false,
      history: true,
      items: true,
      plan: false,
      ritualStepDrafts: false,
      settings: true,
      templates: true,
    })
  })

  it('shows the active tab loading state only until visible data exists', () => {
    const baseInput: SelfCareActiveTabLoadingInput = {
      activeTab: 'today',
      hasAnalytics: false,
      hasDashboard: false,
      hasHistory: false,
      hasItems: false,
      hasPlan: false,
      hasSettings: false,
      isAnalyticsLoading: true,
      isDashboardLoading: true,
      isHistoryLoading: true,
      isItemsLoading: true,
      isPlanLoading: true,
      isSettingsLoading: true,
    }

    expect(isSelfCareActiveTabLoading(baseInput)).toBe(true)
    expect(
      isSelfCareActiveTabLoading({
        ...baseInput,
        hasDashboard: true,
      }),
    ).toBe(false)
    expect(
      isSelfCareActiveTabLoading({
        ...baseInput,
        activeTab: 'analytics',
        hasDashboard: false,
      }),
    ).toBe(true)
    expect(
      isSelfCareActiveTabLoading({
        ...baseInput,
        activeTab: 'analytics',
        hasAnalytics: true,
      }),
    ).toBe(false)
  })

  it('updates tab search params while preserving unrelated params', () => {
    const planParams = getSelfCareTabSearchParams(
      new URLSearchParams('foo=bar'),
      'plan',
    )

    expect(planParams.toString()).toBe('foo=bar&tab=plan')

    const todayParams = getSelfCareTabSearchParams(planParams, 'today')

    expect(todayParams.toString()).toBe('foo=bar')

    const cleanParams = getSelfCareTabSearchParams(
      new URLSearchParams(
        'tab=analytics&analyticsType=exercise&analyticsItemId=exercise-1&foo=bar',
      ),
      'today',
    )

    expect(cleanParams.toString()).toBe('foo=bar')
  })

  it('sets and clears analytics detail search params', () => {
    const detailParams = getSelfCareAnalyticsDetailSearchParams(
      new URLSearchParams('foo=bar'),
      { itemId: 'weight-1', kind: 'measurement' },
    )

    expect(detailParams.toString()).toBe(
      'foo=bar&tab=analytics&analyticsType=measurement&analyticsItemId=weight-1',
    )

    expect(
      getSelfCareAnalyticsOverviewSearchParams(detailParams).toString(),
    ).toBe('foo=bar&tab=analytics')
  })

  it('sets and clears create dialog search params', () => {
    const openParams = getSelfCareCreateDialogSearchParams(
      new URLSearchParams('tab=settings&foo=bar'),
      'custom',
    )

    expect(openParams.toString()).toBe(
      'tab=settings&foo=bar&selfCareAction=care&selfCareActionRequest=custom',
    )

    expect(
      getSelfCareCloseCreateDialogSearchParams(openParams).toString(),
    ).toBe('tab=settings&foo=bar')

    expect(
      getSelfCareCloseCreateDialogAndTabSearchParams(
        openParams,
        'rituals',
      ).toString(),
    ).toBe('tab=rituals&foo=bar')
  })
})
