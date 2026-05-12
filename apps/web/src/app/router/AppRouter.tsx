import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { usePlannerSession } from '@/features/session'
import { TodayPage } from '@/pages/today'

const AdminPage = lazy(() =>
  import('@/pages/admin').then((module) => ({ default: module.AdminPage })),
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

export function AppRouter() {
  const { data: session } = usePlannerSession()

  if (session?.workspace.kind === 'shared') {
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Navigate replace to="/today" />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/shopping" element={<ShoppingPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/spheres" element={<SpheresPage />} />
          <Route path="/spheres/:sphereId" element={<SpherePage />} />
          <Route path="*" element={<Navigate replace to="/today" />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate replace to="/today" />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/habits" element={<HabitsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/shopping" element={<ShoppingPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/spheres" element={<SpheresPage />} />
        <Route path="/spheres/:sphereId" element={<SpherePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate replace to="/today" />} />
      </Routes>
    </Suspense>
  )
}
