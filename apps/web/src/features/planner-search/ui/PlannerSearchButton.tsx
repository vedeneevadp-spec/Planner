import { lazy, Suspense, useState } from 'react'

import { usePlannerSession, useSessionAuth } from '@/features/session'
import { SearchIcon } from '@/shared/ui/Icon'

const PlannerSearchDialog = lazy(() => import('./PlannerSearchDialog'))

export function PlannerSearchButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const { data: session } = usePlannerSession()
  const { sessionVersion } = useSessionAuth()
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="Поиск по Планнеру"
        title="Поиск по Планнеру"
        onClick={() => setOpen(true)}
      >
        <SearchIcon size={17} />
      </button>
      {open ? (
        <Suspense fallback={null}>
          <PlannerSearchDialog
            key={`${session?.workspaceId}:${sessionVersion}`}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
