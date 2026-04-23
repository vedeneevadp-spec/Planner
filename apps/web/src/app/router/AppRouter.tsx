import { Navigate, Route, Routes } from 'react-router-dom'

import { AdminPage } from '@/pages/admin'
import { InboxPage } from '@/pages/inbox'
import { SpherePage, SpheresPage } from '@/pages/spheres'
import { TimelinePage } from '@/pages/timeline'
import { TodayPage } from '@/pages/today'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/today" />} />
      <Route path="/today" element={<TodayPage />} />
      <Route path="/timeline" element={<TimelinePage />} />
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/spheres" element={<SpheresPage />} />
      <Route path="/spheres/:sphereId" element={<SpherePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate replace to="/today" />} />
    </Routes>
  )
}
