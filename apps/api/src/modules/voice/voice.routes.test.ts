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

function createVoiceAudio(durationMs: number): Buffer {
  const sampleCount = Math.round((16_000 * durationMs) / 1000)
  const audio = Buffer.alloc(sampleCount * 2)

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin(index / 7) * 2800)
    audio.writeInt16LE(sample, index * 2)
  }

  return audio
}
