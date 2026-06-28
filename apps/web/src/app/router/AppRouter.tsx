import { lazy, type ReactElement, Suspense } from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'

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
const ContactsPage = lazy(() =>
  import('@/pages/contacts').then((module) => ({
    default: module.ContactsPage,
  })),
)
const MorePage = lazy(() =>
  import('@/pages/more').then((module) => ({ default: module.MorePage })),
)
const ProfilePage = lazy(() =>
  import('@/pages/profile').then((module) => ({ default: module.ProfilePage })),
)
const VoiceAssistantSettingsPage = lazy(() =>
  import('@/pages/voice-assistant-settings').then((module) => ({
    default: module.VoiceAssistantSettingsPage,
  })),
)
const ShoppingPage = lazy(() =>
  import('@/pages/shopping').then((module) => ({
    default: module.ShoppingPage,
  })),
)
const SelfCarePage = lazy(() =>
  import('@/pages/self-care').then((module) => ({
    default: module.SelfCarePage,
  })),
)
const SpherePage = lazy(() =>
  import('@/pages/spheres').then((module) => ({ default: module.SpherePage })),
)
const SpheresPage = lazy(() =>
  import('@/pages/spheres').then((module) => ({ default: module.SpheresPage })),
)
const CALENDAR_VIEW_SEARCH_PARAM = 'calendarView'

function CleaningZoneRedirect() {
  const { zoneId } = useParams()

  return (
    <Navigate
      replace
      to={zoneId ? `/cleaning/settings/zones/${zoneId}` : '/cleaning/settings'}
    />
  )
}

function TimelineRedirect() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  searchParams.set(CALENDAR_VIEW_SEARCH_PARAM, 'day')
  const nextSearch = searchParams.toString()

  return (
    <Navigate
      replace
      to={{
        pathname: '/calendar',
        search: nextSearch ? `?${nextSearch}` : '',
      }}
    />
  )
}

function HabitsRedirect() {
  const { habitId } = useParams()
  const searchParams = new URLSearchParams({ tab: 'rituals' })

  if (habitId) {
    searchParams.set('itemId', habitId)
  }

  return (
    <Navigate
      replace
      to={{
        pathname: '/self-care',
        search: `?${searchParams.toString()}`,
      }}
    />
  )
}

const routeElements = {
  admin: <AdminPage />,
  calendar: <CalendarPage />,
  cleaning: <CleaningPage />,
  cleaningSettings: <CleaningSettingsPage />,
  cleaningSettingsGeneral: <CleaningSettingsPage />,
  cleaningSettingsZone: <CleaningSettingsPage />,
  cleaningZoneRedirect: <CleaningZoneRedirect />,
  contacts: <ContactsPage />,
  habitRedirect: <HabitsRedirect />,
  habitsRedirect: <HabitsRedirect />,
  more: <MorePage />,
  profile: <ProfilePage />,
  selfCare: <SelfCarePage />,
  shopping: <ShoppingPage />,
  sphere: <SpherePage />,
  spheres: <SpheresPage />,
  today: <TodayPage />,
  voiceAssistantSettings: <VoiceAssistantSettingsPage />,
} satisfies Record<AppRouteId, ReactElement>

export function AppRouter() {
  const { data: session } = usePlannerSession()
  const workspaceKind = session?.workspace.kind ?? 'personal'
  const visibleRoutes = getVisibleAppRouteDefinitions(workspaceKind)

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate replace to="/today" />} />
        <Route path="/timeline" element={<TimelineRedirect />} />
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
