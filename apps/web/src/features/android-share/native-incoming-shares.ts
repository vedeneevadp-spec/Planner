import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export interface IncomingShare {
  requestId: string
  subject: string
  text: string
}

interface IncomingSharesPlugin {
  readPendingShare(): Promise<{ share: IncomingShare | null }>
  acknowledgeShare(options: { requestId: string }): Promise<void>
  addListener(
    event: 'pendingShare',
    listener: () => void,
  ): Promise<PluginListenerHandle>
}

export const nativeIncomingShares = registerPlugin<IncomingSharesPlugin>(
  'PlannerIncomingShares',
)
