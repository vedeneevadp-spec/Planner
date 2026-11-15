import { useCallback, useSyncExternalStore } from 'react'

import {
  readWorkspaceWriteEpochs,
  subscribeWorkspaceEpochs,
} from './workspace-epoch'

export function useWorkspaceWriteEpochSnapshot(
  workspaceId: string | undefined,
  actorId: string | undefined,
): string {
  const read = useCallback(
    () =>
      JSON.stringify(
        workspaceId ? readWorkspaceWriteEpochs(workspaceId, actorId) : {},
      ),
    [workspaceId, actorId],
  )
  return useSyncExternalStore(subscribeWorkspaceEpochs, read, read)
}
