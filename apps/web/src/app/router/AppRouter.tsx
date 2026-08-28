import { lazy, type ReactElement, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router'

import { usePlannerSession } from '@/features/session'
import {
  type AppRouteId,
  getVisibleAppRouteDefinitions,
} from '@/shared/config/routes'
import { AsyncLoadErrorBoundary } from '@/shared/ui/AsyncLoadErrorBoundary'
import { PageStateView } from '@/shared/ui/PageState'

import styles from './AppRouter.module.css'

const TodayPage = lazy(() =>
  import('@/pages/today').then((module) => ({ default: module.TodayPage })),
)
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
const NotificationsSettingsPage = lazy(() =>
  import('@/pages/notifications-settings').then((module) => ({
    default: module.NotificationsSettingsPage,
  })),
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
  notificationsSettings: <NotificationsSettingsPage />,
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
  const location = useLocation()
  const workspaceKind = session?.workspace.kind ?? 'personal'
  const visibleRoutes = getVisibleAppRouteDefinitions(workspaceKind)

  return (
    <AsyncLoadErrorBoundary
      fallback={<RouteLoadError />}
      onError={(error) => {
        console.warn('Failed to load a planner route.', error)
      }}
      resetKey={`${location.pathname}${location.search}`}
    >
      <Suspense fallback={<RouteFallback />}>
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
    </AsyncLoadErrorBoundary>
  )
}

function RouteLoadError() {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

  return (
    <PageStateView
      action={{
        label: 'Повторить',
        onClick: () => {
          window.location.reload()
        },
      }}
      description={
        isOffline
          ? 'Этот раздел ещё не сохранён на устройстве. Подключитесь к интернету и повторите.'
          : 'Обновите страницу. Если ошибка повторится, попробуйте ещё раз позже.'
      }
      kind={isOffline ? 'offline' : 'error'}
      title={
        isOffline
          ? 'Раздел не загрузился без сети'
          : 'Не удалось открыть раздел'
      }
    />
  )
}

function RouteFallback() {
  return (
    <div className={styles.routeFallback} role="status" aria-live="polite">
      <span className={styles.routeFallbackStatus}>Загружаем раздел</span>
      <div className={styles.routeFallbackPanel} aria-hidden="true">
        <span className={styles.routeFallbackLine} />
        <span
          className={`${styles.routeFallbackLine} ${styles.routeFallbackLineShort}`}
        />
      </div>
    </div>
  )
}
