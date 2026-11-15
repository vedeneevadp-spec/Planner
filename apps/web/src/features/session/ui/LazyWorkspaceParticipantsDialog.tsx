import { lazy, Suspense } from 'react'

import { PlannerDialog } from '@/shared/ui/PlannerDialog/PlannerDialog'

import type { WorkspaceParticipantsDialogProps } from './WorkspaceParticipantsDialog'

const ParticipantsDialog = lazy(() =>
  import('./WorkspaceParticipantsDialog').then((module) => ({
    default: module.WorkspaceParticipantsDialog,
  })),
)

export function LazyWorkspaceParticipantsDialog(
  props: WorkspaceParticipantsDialogProps,
) {
  if (!props.isOpen) return null

  return (
    <Suspense
      fallback={
        <PlannerDialog title="Участники пространства" onClose={props.onClose}>
          <p role="status">Загружаем участников…</p>
        </PlannerDialog>
      }
    >
      <ParticipantsDialog {...props} />
    </Suspense>
  )
}
