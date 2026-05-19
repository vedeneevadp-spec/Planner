import { lazy, type ReactElement, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'

import { usePlannerSession } from '@/features/session'
import { TodayPage } from '@/pages/today'
import {
  type AppRouteId,
  getVisibleAppRouteDefinitions,
} from '@/shared/config/routes'

const AdminPage = lazy(() =>
  import('@/pages/admin').then((module) => ({ default: module.AdminPage })),
)
const CalendarPage = lazy(() =>
  import('@/pages/calendar').then((module) => ({
    default: module.CalendarPage,
  })),
)
const CleaningPage = lazy(() =>
  import('@/pages/cleaning').then((module) => ({
    default: module.CleaningPage,
  })),
)
const CleaningSettingsPage = lazy(() =>
  import('@/pages/cleaning').then((module) => ({
    default: module.CleaningSettingsPage,
  })),
)
const HabitsPage = lazy(() =>
  import('@/pages/habits').then((module) => ({ default: module.HabitsPage })),
)
const ProfilePage = lazy(() =>
  import('@/pages/profile').then((module) => ({ default: module.ProfilePage })),
)
const ShoppingPage = lazy(() =>
  import('@/pages/shopping').then((module) => ({
    default: module.ShoppingPage,
  })),
)
const SpherePage = lazy(() =>
  import('@/pages/spheres').then((module) => ({ default: module.SpherePage })),
)
const SpheresPage = lazy(() =>
  import('@/pages/spheres').then((module) => ({ default: module.SpheresPage })),
)
const TimelinePage = lazy(() =>
  import('@/pages/timeline').then((module) => ({
    default: module.TimelinePage,
  })),
)

function CleaningZoneRedirect() {
  const { zoneId } = useParams()

  return (
    <Navigate
      replace
      to={zoneId ? `/cleaning/settings/zones/${zoneId}` : '/cleaning/settings'}
    />
  )
}

const routeElements = {
  admin: <AdminPage />,
  calendar: <CalendarPage />,
  cleaning: <CleaningPage />,
  cleaningSettings: <CleaningSettingsPage />,
  cleaningSettingsZone: <CleaningSettingsPage />,
  cleaningZoneRedirect: <CleaningZoneRedirect />,
  habits: <HabitsPage />,
  profile: <ProfilePage />,
  shopping: <ShoppingPage />,
  sphere: <SpherePage />,
  spheres: <SpheresPage />,
  timeline: <TimelinePage />,
  today: <TodayPage />,
} satisfies Record<AppRouteId, ReactElement>

export function AppRouter() {
  const { data: session } = usePlannerSession()
  const workspaceKind = session?.workspace.kind ?? 'personal'
  const visibleRoutes = getVisibleAppRouteDefinitions(workspaceKind)

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate replace to="/today" />} />
        {visibleRoutes.map((route) => (
          <Route
            key={route.id}
            path={route.path}
            element={routeElements[route.id]}
          />
        ))}
        <Route path="*" element={<Navigate replace to="/today" />} />
      </Routes>
    </Suspense>
  )
}
