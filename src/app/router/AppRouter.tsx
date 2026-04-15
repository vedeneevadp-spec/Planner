import { Navigate, Route, Routes } from 'react-router-dom'

import { InboxPage } from '@/pages/inbox/ui/InboxPage'
import { ProjectsPage } from '@/pages/projects/ui/ProjectsPage'
import { TodayPage } from '@/pages/today/ui/TodayPage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/today" />} />
      <Route path="/today" element={<TodayPage />} />
      <Route path="/inbox" element={<InboxPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
    </Routes>
  )
}
