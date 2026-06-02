import type {
  PushDeviceRecord as ContractPushDeviceRecord,
  PushDeviceUpsertInput as ContractPushDeviceUpsertInput,
  PushTestNotificationInput as ContractPushTestNotificationInput,
  PushTestNotificationResponse as ContractPushTestNotificationResponse,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type PushDeviceRecord = ContractPushDeviceRecord
export type PushDeviceUpsertInput = ContractPushDeviceUpsertInput
export type PushTestNotificationInput = ContractPushTestNotificationInput
export type PushTestNotificationResponse = ContractPushTestNotificationResponse

export interface PushNotificationSession {
  actorUserId: string
  auth?: AuthenticatedRequestContext | null | undefined
  workspaceId: string
}

export interface PushNotificationRecipient {
  userId: string
  workspaceId: string
}

export interface PushNotificationMessage {
  body: string
  data?: Record<string, string> | undefined
  title: string
}

export interface PushNotificationSendResult {
  deliveredCount: number
  failedCount: number
  invalidTokens: string[]
}

export interface PushNotificationSender {
  isAvailable: () => boolean
  sendToTokens: (
    tokens: readonly string[],
    message: PushNotificationMessage,
  ) => Promise<PushNotificationSendResult>
}
