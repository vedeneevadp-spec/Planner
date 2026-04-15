import { Navigate, Route, Routes } from 'react-router-dom'

import { InboxPage } from '@/pages/inbox'
import { ProjectsPage } from '@/pages/projects'
import { TodayPage } from '@/pages/today'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/today" />} />
      <Route path="/today" element={<TodayPage />} />
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="*" element={<Navigate replace to="/today" />} />
    </Routes>
  )
}
