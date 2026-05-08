import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { describe, it } from 'node:test'

import { FirebasePushNotificationSender } from './push-notifications.delivery.js'

const PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {
    format: 'pem',
    type: 'pkcs8',
  },
  publicKeyEncoding: {
    format: 'pem',
    type: 'spki',
  },
}).privateKey

void describe('FirebasePushNotificationSender', () => {
  void it('sends unique tokens through FCM HTTP v1 with cached OAuth token', async () => {
    const calls: Array<{ body: unknown; url: string }> = []
    const sender = new FirebasePushNotificationSender(
      {
        clientEmail: 'firebase-admin@example.iam.gserviceaccount.com',
        privateKey: PRIVATE_KEY,
        projectId: 'planner-mobile',
      },
      (url, init) => {
        const requestUrl = stringifyFetchUrl(url)

        calls.push({
          body: parseBody(init?.body),
          url: requestUrl,
        })

        if (requestUrl === 'https://oauth2.googleapis.com/token') {
          return Promise.resolve(
            jsonResponse({
              access_token: 'oauth-token',
              expires_in: 3600,
            }),
          )
        }

        return Promise.resolve(
          jsonResponse({
            name: 'projects/planner-mobile/messages/message-id',
          }),
        )
      },
    )

    const firstResult = await sender.sendToTokens(
      ['token-a', 'token-b', 'token-a', ''],
      {
        body: 'Body',
        data: { taskId: 'task-1' },
        title: 'Title',
      },
    )
    const secondResult = await sender.sendToTokens(['token-c'], {
      body: 'Body',
      title: 'Title',
    })

    assert.deepEqual(firstResult, {
      deliveredCount: 2,
      failedCount: 0,
      invalidTokens: [],
    })
    assert.deepEqual(secondResult, {
      deliveredCount: 1,
      failedCount: 0,
      invalidTokens: [],
    })
    assert.equal(
      calls.filter((call) => call.url === 'https://oauth2.googleapis.com/token')
        .length,
      1,
    )
    assert.deepEqual(calls[1], {
      body: {
        message: {
          android: {
            notification: {
              channel_id: 'chaotika-general',
            },
            priority: 'HIGH',
          },
          data: {
            taskId: 'task-1',
          },
          notification: {
            body: 'Body',
            title: 'Title',
          },
          token: 'token-a',
        },
      },
      url: 'https://fcm.googleapis.com/v1/projects/planner-mobile/messages:send',
    })
  })

  void it('reports unregistered FCM tokens as invalid tokens', async () => {
    const sender = new FirebasePushNotificationSender(
      {
        clientEmail: 'firebase-admin@example.iam.gserviceaccount.com',
        privateKey: PRIVATE_KEY,
        projectId: 'planner-mobile',
      },
      (url) => {
        if (stringifyFetchUrl(url) === 'https://oauth2.googleapis.com/token') {
          return Promise.resolve(
            jsonResponse({
              access_token: 'oauth-token',
              expires_in: 3600,
            }),
          )
        }

        return Promise.resolve(
          jsonResponse(
            {
              error: {
                details: [
                  {
                    '@type':
                      'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                    errorCode: 'UNREGISTERED',
                  },
                ],
                status: 'NOT_FOUND',
              },
            },
            404,
          ),
        )
      },
    )

    assert.deepEqual(
      await sender.sendToTokens(['missing-token'], {
        body: 'Body',
        title: 'Title',
      }),
      {
        deliveredCount: 0,
        failedCount: 1,
        invalidTokens: ['missing-token'],
      },
    )
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  })
}

function parseBody(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function stringifyFetchUrl(value: Parameters<typeof fetch>[0]): string {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof URL) {
    return value.toString()
  }

  return value.url
}
