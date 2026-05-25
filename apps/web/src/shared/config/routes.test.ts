import { describe, expect, it } from 'vitest'

import {
  getVisibleAppRouteDefinitions,
  getVisibleNavigationRouteDefinitions,
} from './routes'

describe('route config', () => {
  it('keeps shared workspace app routes restricted to shared-safe screens', () => {
    const routeIds = getVisibleAppRouteDefinitions('shared').map(
      (route) => route.id,
    )

    expect(routeIds).toContain('today')
    expect(routeIds).toContain('calendar')
    expect(routeIds).toContain('shopping')
    expect(routeIds).toContain('timeline')
    expect(routeIds).toContain('spheres')
    expect(routeIds).toContain('more')
    expect(routeIds).not.toContain('admin')
    expect(routeIds).not.toContain('habits')
    expect(routeIds).not.toContain('profile')
  })

  it('uses the same visibility policy for shared workspace navigation', () => {
    const routeIds = getVisibleNavigationRouteDefinitions('shared').map(
      (route) => route.id,
    )

    expect(routeIds).toEqual([
      'today',
      'calendar',
      'shopping',
      'cleaning',
      'timeline',
      'spheres',
    ])
  })

  it('keeps the mobile more menu order from the existing sidebar', () => {
    const routeIds = getVisibleNavigationRouteDefinitions('personal')
      .filter((route) => route.mobilePlacement === 'more')
      .sort((left, right) => (left.mobileOrder ?? 0) - (right.mobileOrder ?? 0))
      .map((route) => route.id)

    expect(routeIds).toEqual(['timeline', 'spheres', 'habits', 'admin'])
  })

  it('keeps personal workspace-only routes visible for personal workspaces', () => {
    const routeIds = getVisibleAppRouteDefinitions('personal').map(
      (route) => route.id,
    )

    expect(routeIds).toContain('admin')
    expect(routeIds).toContain('habits')
    expect(routeIds).toContain('more')
    expect(routeIds).toContain('profile')
  })
})
