import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'

import type { AppRole } from '@planner/contracts'
import Fastify from 'fastify'

import type { SessionService } from '../session/index.js'
import type {
  BackendSttProvider,
  BackendSttProviderInput,
  BackendSttProviderResult,
} from './voice.model.js'
import { registerVoiceRoutes } from './voice.routes.js'
import { VoiceCommandService } from './voice.service.js'

void describe('voice routes', () => {
  void it('accepts a raw PCM clip and returns transcript with PlannerIntent', async () => {
    const app = createAuthenticatedFastify()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(
        new FakeSttProvider('добавь задачу позвонить врачу завтра'),
      ),
    )

    const response = await app.inject({
      headers: createVoiceHeaders({
        'content-type': 'audio/l16',
        'x-stt-source': 'android_push_to_talk',
        'x-workspace-id': 'workspace-1',
      }),
      method: 'POST',
      payload: createVoiceAudio(900),
      url: '/api/voice/command',
    })

    await app.close()

    assert.equal(response.statusCode, 200)

    const body = JSON.parse(response.body) as {
      intent: { intent: string; title?: string }
      stt: { source: string }
      transcript: string
    }

    assert.equal(body.transcript, 'добавь задачу позвонить врачу завтра')
    assert.equal(body.stt.source, 'android_push_to_talk')
    assert.equal(body.intent.intent, 'create_task')
    assert.equal(body.intent.title, 'позвонить врачу')
  })

  void it('allows global test users to use the voice endpoint', async () => {
    const app = createAuthenticatedFastify()
    const provider = new FakeSttProvider('добавь в покупки молоко')

    registerVoiceRoutes(
      app,
      createFakeSessionService('test') as unknown as SessionService,
      new VoiceCommandService(provider),
    )

    const response = await app.inject({
      headers: createVoiceHeaders({
        'content-type': 'audio/l16',
        'x-stt-source': 'android_push_to_talk',
        'x-workspace-id': 'workspace-1',
      }),
      method: 'POST',
      payload: createVoiceAudio(900),
      url: '/api/voice/command',
    })

    await app.close()

    assert.equal(response.statusCode, 200)
    assert.equal(provider.callCount, 1)
  })

  void it('accepts web push-to-talk source', async () => {
    const app = createAuthenticatedFastify()
    const provider = new FakeSttProvider('добавь задачу написать отчет')

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(provider),
    )

    const response = await app.inject({
      headers: createVoiceHeaders({
        'content-type': 'audio/l16',
        'x-stt-source': 'web_push_to_talk',
        'x-workspace-id': 'workspace-1',
      }),
      method: 'POST',
      payload: createVoiceAudio(900),
      url: '/api/voice/command',
    })

    await app.close()

    assert.equal(response.statusCode, 200)

    const body = JSON.parse(response.body) as {
      stt: { source: string }
    }

    assert.equal(body.stt.source, 'web_push_to_talk')
    assert.equal(provider.callCount, 1)
  })

  void it('passes client parser time headers into PlannerIntent parsing', async () => {
    const app = createAuthenticatedFastify()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(
        new FakeSttProvider('через полчаса проверить духовку'),
      ),
    )

    const response = await app.inject({
      headers: createVoiceHeaders({
        'content-type': 'audio/l16',
        'x-client-now': '2026-05-29T06:54:00.000Z',
        'x-client-timezone': 'Asia/Novosibirsk',
        'x-stt-source': 'android_push_to_talk',
        'x-workspace-id': 'workspace-1',
      }),
      method: 'POST',
      payload: createVoiceAudio(900),
      url: '/api/voice/command',
    })

    await app.close()

    assert.equal(response.statusCode, 200)

    const body = JSON.parse(response.body) as {
      intent: { reminderAt?: string }
    }

    assert.equal(body.intent.reminderAt, '2026-05-29T14:24')
  })

  void it('rejects non-rollout roles before calling the STT provider', async () => {
    for (const appRole of ['admin', 'user', 'guest'] satisfies AppRole[]) {
      const app = createAuthenticatedFastify()
      const provider = new FakeSttProvider('добавь задачу')

      registerVoiceRoutes(
        app,
        createFakeSessionService(appRole) as unknown as SessionService,
        new VoiceCommandService(provider),
      )

      const response = await app.inject({
        headers: createVoiceHeaders({
          'content-type': 'audio/l16',
          'x-stt-source': 'android_push_to_talk',
          'x-workspace-id': 'workspace-1',
        }),
        method: 'POST',
        payload: createVoiceAudio(900),
        url: '/api/voice/command',
      })

      await app.close()

      assert.equal(response.statusCode, 403)
      assert.equal(provider.callCount, 0)
    }
  })

  void it('rejects clips above the route hard limit before STT', async () => {
    const app = createAuthenticatedFastify()
    const provider = new FakeSttProvider('добавь задачу')

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(provider),
    )

    const response = await app.inject({
      headers: createVoiceHeaders({
        'content-type': 'audio/l16',
        'x-stt-source': '',
        'x-workspace-id': 'workspace-1',
      }),
      method: 'POST',
      payload: Buffer.alloc(401 * 1024),
      url: '/api/voice/command',
    })

    await app.close()

    assert.equal(response.statusCode, 413)
    assert.equal(provider.callCount, 0)
  })

  void it('requires authenticated requests', async () => {
    const app = Fastify()
    const provider = new FakeSttProvider('добавь задачу')

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(provider),
    )

    const response = await app.inject({
      headers: createVoiceHeaders({
        'content-type': 'audio/l16',
        'x-stt-source': 'android_push_to_talk',
        'x-workspace-id': 'workspace-1',
      }),
      method: 'POST',
      payload: createVoiceAudio(900),
      url: '/api/voice/command',
    })

    await app.close()

    assert.equal(response.statusCode, 401)
    assert.equal(provider.callCount, 0)
  })

  void it('rejects missing source before STT', async () => {
    const app = createAuthenticatedFastify()
    const provider = new FakeSttProvider('добавь задачу')

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(provider),
    )

    const response = await app.inject({
      headers: createVoiceHeaders({
        'content-type': 'audio/l16',
        'x-stt-source': '',
        'x-workspace-id': 'workspace-1',
      }),
      method: 'POST',
      payload: createVoiceAudio(900),
      url: '/api/voice/command',
    })

    await app.close()

    assert.equal(response.statusCode, 400)
    assert.equal(provider.callCount, 0)
  })

  void it('accepts safe voice metric payloads through the metrics endpoint', async () => {
    const app = createAuthenticatedFastify()
    const metrics = new FakeMetricsSink()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(new FakeSttProvider('добавь задачу'), metrics),
    )

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: JSON.stringify({
        appRole: 'owner',
        createdAt: '2026-06-01T00:00:00.000Z',
        eventName: 'confirmation_accepted',
        intentType: 'create_task',
        platform: 'web',
        previewStatus: 'ready_for_confirmation',
        source: 'web_push_to_talk',
        time_to_confirmation_card_ms: 800,
      }),
      url: '/api/voice/metrics',
    })

    await app.close()

    assert.equal(response.statusCode, 200)
    assert.equal(metrics.events.length, 1)
    assert.equal(metrics.events[0]?.event, 'confirmation_accepted')
    assert.equal(metrics.events[0]?.details?.time_to_confirmation_card_ms, 800)
  })

  void it('rejects private voice metric payloads before recording them', async () => {
    const app = createAuthenticatedFastify()
    const metrics = new FakeMetricsSink()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(new FakeSttProvider('добавь задачу'), metrics),
    )

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: JSON.stringify({
        appRole: 'owner',
        createdAt: '2026-06-01T00:00:00.000Z',
        eventName: 'intent_parsed',
        intent: {
          intent: 'create_task',
          rawText: 'секретная команда',
          title: 'секретная задача',
        },
        platform: 'web',
        source: 'web_push_to_talk',
        transcript: 'секретная команда',
      }),
      url: '/api/voice/metrics',
    })

    await app.close()

    assert.equal(response.statusCode, 400)
    assert.equal(metrics.events.length, 0)
    assert.match(response.body, /private_voice_metric_payload/)
    assert.doesNotMatch(JSON.stringify(metrics.events), /секретная/)
  })

  void it('rejects batched voice metric payloads', async () => {
    const app = createAuthenticatedFastify()
    const metrics = new FakeMetricsSink()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(new FakeSttProvider('добавь задачу'), metrics),
    )

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: JSON.stringify([
        createVoiceMetricPayload(),
        createVoiceMetricPayload({ eventName: 'confirmation_cancelled' }),
      ]),
      url: '/api/voice/metrics',
    })

    await app.close()

    assert.equal(response.statusCode, 400)
    assert.match(response.body, /voice_metric_batch_too_large/)
    assert.equal(metrics.events.length, 0)
  })

  void it('rejects voice metric payloads above the endpoint body limit', async () => {
    const app = createAuthenticatedFastify()
    const metrics = new FakeMetricsSink()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(new FakeSttProvider('добавь задачу'), metrics),
    )

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: JSON.stringify({
        ...createVoiceMetricPayload(),
        padding: 'x'.repeat(17 * 1024),
      }),
      url: '/api/voice/metrics',
    })

    await app.close()

    assert.equal(response.statusCode, 413)
    assert.equal(metrics.events.length, 0)
  })

  void it('rejects unknown voice metric event names and fields', async () => {
    const app = createAuthenticatedFastify()
    const metrics = new FakeMetricsSink()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(new FakeSttProvider('добавь задачу'), metrics),
    )

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: JSON.stringify({
        ...createVoiceMetricPayload(),
        eventName: 'unknown_voice_event',
        unsafeExtra: 'not allowed',
      }),
      url: '/api/voice/metrics',
    })

    await app.close()

    assert.equal(response.statusCode, 400)
    assert.match(response.body, /invalid_voice_metric_payload/)
    assert.equal(metrics.events.length, 0)
  })

  void it('rate limits voice metric payloads by user, device, and IP', async () => {
    const app = createAuthenticatedFastify()
    const metrics = new FakeMetricsSink()

    registerVoiceRoutes(
      app,
      createFakeSessionService() as unknown as SessionService,
      new VoiceCommandService(new FakeSttProvider('добавь задачу'), metrics),
    )

    for (let index = 0; index < 120; index += 1) {
      const response = await app.inject({
        headers: {
          'content-type': 'application/json',
          'x-device-id': 'device-1',
          'x-workspace-id': 'workspace-1',
        },
        method: 'POST',
        payload: JSON.stringify(
          createVoiceMetricPayload({ eventName: 'confirmation_shown' }),
        ),
        url: '/api/voice/metrics',
      })

      assert.equal(response.statusCode, 200)
    }

    const rejected = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-device-id': 'device-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: JSON.stringify(createVoiceMetricPayload()),
      url: '/api/voice/metrics',
    })

    await app.close()

    assert.equal(rejected.statusCode, 429)
    assert.match(rejected.body, /voice_metric_rate_limited/)
    assert.equal(metrics.events.length, 120)
  })
})

class FakeSttProvider implements BackendSttProvider {
  callCount = 0

  constructor(private readonly transcript: string) {}

  isAvailable(): boolean {
    return true
  }

  transcribe(
    _input: BackendSttProviderInput,
  ): Promise<BackendSttProviderResult> {
    this.callCount += 1

    return Promise.resolve({
      confidence: null,
      provider: 'backend_yandex_speechkit',
      transcript: this.transcript,
    })
  }
}

class FakeMetricsSink {
  readonly events: Array<{
    details?: Record<string, unknown>
    event: string
  }> = []

  record(event: string, details?: Record<string, unknown>): void {
    this.events.push(details ? { details, event } : { event })
  }
}

function createFakeSessionService(appRole: AppRole = 'owner') {
  return {
    resolveSession() {
      return Promise.resolve({
        actor: {
          displayName: 'Voice Test User',
        },
        actorUserId: 'user-1',
        appRole,
        groupRole: null,
        role: 'owner',
        workspace: {
          kind: 'personal',
          name: 'Voice Workspace',
        },
        workspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            kind: 'personal',
            name: 'Voice Workspace',
          },
        ],
      })
    },
  }
}

function createAuthenticatedFastify() {
  const app = Fastify()

  app.decorateRequest('authContext', null)
  app.addHook('onRequest', (request, _reply, done) => {
    request.authContext = {
      accessToken: 'test-access-token',
      claims: {
        payload: {},
        role: 'authenticated',
        sub: 'user-1',
      },
    }
    done()
  })

  return app
}

function createVoiceHeaders(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    'x-stt-source': 'android_short_clip',
    'x-voice-issued-at': new Date().toISOString(),
    'x-voice-request-id': randomUUID(),
    'x-voice-session-id': 'voice-session-1',
    ...overrides,
  }
}

function createVoiceMetricPayload(overrides: Record<string, unknown> = {}) {
  return {
    appRole: 'owner',
    createdAt: '2026-06-01T00:00:00.000Z',
    eventName: 'confirmation_accepted',
    intentType: 'create_task',
    platform: 'web',
    source: 'web_push_to_talk',
    ...overrides,
  }
}

function createVoiceAudio(durationMs: number): Buffer {
  const sampleCount = Math.round((16_000 * durationMs) / 1000)
  const audio = Buffer.alloc(sampleCount * 2)

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(index / 7) * 2800)
    audio.writeInt16LE(sample, index * 2)
  }

  return audio
}
