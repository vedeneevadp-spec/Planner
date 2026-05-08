import { importPKCS8, SignJWT } from 'jose'

import type { FirebasePushConfig } from '../../bootstrap/config.js'
import type {
  PushNotificationMessage,
  PushNotificationSender,
  PushNotificationSendResult,
} from './push-notifications.model.js'

type FetchFn = typeof fetch

interface CachedAccessToken {
  expiresAt: number
  value: string
}

interface SingleTokenSendResult {
  delivered: boolean
  invalidToken: boolean
}

const FCM_OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const FCM_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PUSH_NOTIFICATION_CHANNEL_ID = 'chaotika-general'
const MULTICAST_BATCH_SIZE = 500
const ACCESS_TOKEN_REFRESH_GRACE_MS = 60_000
const INVALID_FCM_ERROR_CODES = new Set(['INVALID_ARGUMENT', 'UNREGISTERED'])

export class FirebasePushNotificationSender implements PushNotificationSender {
  private accessToken: CachedAccessToken | null = null
  private accessTokenRequest: Promise<string> | null = null
  private readonly signingKey: ReturnType<typeof importPKCS8>

  constructor(
    private readonly config: FirebasePushConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.signingKey = importPKCS8(config.privateKey, 'RS256')
  }

  isAvailable(): boolean {
    return true
  }

  async sendToTokens(
    tokens: readonly string[],
    message: PushNotificationMessage,
  ): Promise<PushNotificationSendResult> {
    const uniqueTokens = [...new Set(tokens)].filter(
      (token) => token.length > 0,
    )
    const invalidTokens: string[] = []
    let deliveredCount = 0
    let failedCount = 0

    for (
      let index = 0;
      index < uniqueTokens.length;
      index += MULTICAST_BATCH_SIZE
    ) {
      const batchTokens = uniqueTokens.slice(
        index,
        index + MULTICAST_BATCH_SIZE,
      )
      const batchResults = await Promise.all(
        batchTokens.map((token) => this.sendToToken(token, message)),
      )

      batchResults.forEach((result, resultIndex) => {
        if (result.delivered) {
          deliveredCount += 1
          return
        }

        failedCount += 1

        if (result.invalidToken) {
          invalidTokens.push(batchTokens[resultIndex]!)
        }
      })
    }

    return {
      deliveredCount,
      failedCount,
      invalidTokens,
    }
  }

  private async sendToToken(
    token: string,
    message: PushNotificationMessage,
    didRetryAuth = false,
  ): Promise<SingleTokenSendResult> {
    const accessToken = await this.getAccessToken()
    const response = await this.fetchFn(this.getFcmSendUrl(), {
      body: JSON.stringify(buildFcmSendRequestBody(token, message)),
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    if (response.ok) {
      return {
        delivered: true,
        invalidToken: false,
      }
    }

    if (response.status === 401 && !didRetryAuth) {
      this.accessToken = null
      return this.sendToToken(token, message, true)
    }

    return {
      delivered: false,
      invalidToken: isInvalidFcmTokenResponse(
        await readResponsePayload(response),
      ),
    }
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      this.accessToken.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_GRACE_MS
    ) {
      return this.accessToken.value
    }

    if (this.accessTokenRequest) {
      return this.accessTokenRequest
    }

    this.accessTokenRequest = this.requestAccessToken().finally(() => {
      this.accessTokenRequest = null
    })

    return this.accessTokenRequest
  }

  private async requestAccessToken(): Promise<string> {
    const assertion = await this.createAccessTokenAssertion()
    const response = await this.fetchFn(FCM_OAUTH_TOKEN_URL, {
      body: new URLSearchParams({
        assertion,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    })
    const payload = await readResponsePayload(response)

    if (!response.ok) {
      throw new Error('Failed to authorize Firebase Cloud Messaging request.')
    }

    if (!isOAuthTokenResponse(payload)) {
      throw new Error('Firebase Cloud Messaging returned an invalid token.')
    }

    this.accessToken = {
      expiresAt: Date.now() + payload.expires_in * 1000,
      value: payload.access_token,
    }

    return this.accessToken.value
  }

  private async createAccessTokenAssertion(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000)

    return new SignJWT({
      scope: FCM_OAUTH_SCOPE,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setAudience(FCM_OAUTH_TOKEN_URL)
      .setExpirationTime(nowSeconds + 3600)
      .setIssuedAt(nowSeconds)
      .setIssuer(this.config.clientEmail)
      .setSubject(this.config.clientEmail)
      .sign(await this.signingKey)
  }

  private getFcmSendUrl(): string {
    return `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
      this.config.projectId,
    )}/messages:send`
  }
}

export class NoopPushNotificationSender implements PushNotificationSender {
  isAvailable(): boolean {
    return false
  }

  sendToTokens(): Promise<PushNotificationSendResult> {
    throw new Error('Firebase push notifications are not configured.')
  }
}

function buildFcmSendRequestBody(
  token: string,
  message: PushNotificationMessage,
): Record<string, unknown> {
  return {
    message: {
      android: {
        notification: {
          channel_id: PUSH_NOTIFICATION_CHANNEL_ID,
        },
        priority: 'HIGH',
      },
      ...(message.data ? { data: message.data } : {}),
      notification: {
        body: message.body,
        title: message.title,
      },
      token,
    },
  }
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text()

  if (!text) {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function isOAuthTokenResponse(value: unknown): value is {
  access_token: string
  expires_in: number
} {
  return (
    isRecord(value) &&
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    typeof value.expires_in === 'number' &&
    Number.isFinite(value.expires_in) &&
    value.expires_in > 0
  )
}

function isInvalidFcmTokenResponse(payload: unknown): boolean {
  const fcmErrorCode = findFcmErrorCode(payload)

  return Boolean(fcmErrorCode && INVALID_FCM_ERROR_CODES.has(fcmErrorCode))
}

function findFcmErrorCode(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = findFcmErrorCode(item)

      if (code) {
        return code
      }
    }

    return null
  }

  if (!isRecord(value)) {
    return null
  }

  if (typeof value.errorCode === 'string') {
    return value.errorCode
  }

  for (const child of Object.values(value)) {
    const code = findFcmErrorCode(child)

    if (code) {
      return code
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
