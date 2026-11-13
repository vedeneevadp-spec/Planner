import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GooglePlayTestingState } from '@planner/contracts'

import { buildApiApp } from '../../bootstrap/build-app.js'
import { createApiConfig } from '../../bootstrap/config.js'
import { HttpError } from '../../bootstrap/http-error.js'
import { MemorySessionRepository, SessionService } from '../session/index.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'
import { MemoryGooglePlayTestingRepository } from './google-play-testing.repository.js'

const ADMIN = '11111111-1111-4111-8111-111111111111'
const USER = '44444444-4444-4444-8444-444444444444'
const OTHER = '55555555-5555-4555-8555-555555555555'
const root = '/api/v1/google-play-testing'
const adminRoot = '/api/v1/admin/google-play-testing'

void test('testing requests enforce private access, manual invitations, revisions and campaign closure', async (t) => {
  const sessions = new MemorySessionRepository()
  const resolve = sessions.resolve.bind(sessions)
  sessions.resolve = async (context) => {
    const session = await resolve(context)
    return {
      ...session,
      appRole: context.auth?.claims.sub === ADMIN ? 'admin' : 'user',
    }
  }
  const app = buildApiApp({
    config: createApiConfig({
      NODE_ENV: 'test',
      API_AUTH_MODE: 'disabled',
      API_STORAGE_DRIVER: 'memory',
    }),
    database: null,
    sessionService: new SessionService(sessions),
    taskService: new TaskService(new MemoryTaskRepository()),
    googlePlayTestingRepository: new MemoryGooglePlayTestingRepository(),
    requestAuthenticator: {
      authenticate(request) {
        const sub = request.headers.authorization?.replace('Bearer ', '')
        if (!sub || ![ADMIN, USER, OTHER].includes(sub))
          throw new HttpError(401, 'unauthorized', 'Sign in')
        return Promise.resolve({
          accessToken: 'session',
          claims: {
            sub,
            role: 'authenticated',
            payload: { sub, role: 'authenticated' },
          },
        })
      },
    },
  })
  t.after(() => app.close())
  const headers = (id: string) => ({ authorization: `Bearer ${id}` })
  const state = async (id = USER) => {
    const response = await app.inject({ url: root, headers: headers(id) })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.headers['cache-control'], 'no-store')
    return response.json<GooglePlayTestingState>()
  }
  const submit = (email: string, id = USER) =>
    app.inject({
      method: 'PUT',
      url: `${root}/request`,
      headers: headers(id),
      payload: { googleEmail: email },
    })
  const open = (isOpen: boolean) =>
    app.inject({
      method: 'PATCH',
      url: adminRoot,
      headers: headers(ADMIN),
      payload: { isOpen },
    })
  const approve = (revision: number, id = ADMIN) =>
    app.inject({
      method: 'PATCH',
      url: `${adminRoot}/requests/${USER}`,
      headers: headers(id),
      payload: { status: 'invited', revision },
    })

  assert.equal((await app.inject({ url: root })).statusCode, 401)
  assert.equal(
    (await app.inject({ url: adminRoot, headers: headers(USER) })).statusCode,
    403,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: adminRoot,
        headers: headers(USER),
        payload: { isOpen: true },
      })
    ).statusCode,
    403,
  )
  assert.equal((await state()).isOpen, false)
  assert.equal((await submit('tester@gmail.com')).statusCode, 409)
  assert.equal((await open(true)).statusCode, 200)
  assert.equal((await submit('not-email')).statusCode, 400)
  const pending = await submit(' Tester@Gmail.com ')
  assert.equal(pending.statusCode, 200, pending.body)
  assert.equal(
    pending.json<GooglePlayTestingState>().request?.googleEmail,
    'tester@gmail.com',
  )
  assert.equal(pending.json<GooglePlayTestingState>().invitation, null)
  assert.equal((await state(OTHER)).request, null)
  assert.equal((await approve(1, USER)).statusCode, 403)
  assert.equal((await approve(1)).statusCode, 200)
  const invited = await state()
  assert.equal(
    invited.invitation?.joinUrl,
    'https://play.google.com/apps/testing/ru.chaotika.app',
  )
  assert.equal(invited.request?.status, 'invited')
  await submit('tester@gmail.com')
  assert.equal((await state()).request?.revision, 2)
  await submit('changed@example.test')
  assert.equal((await state()).invitation, null)
  assert.equal((await approve(2)).statusCode, 409)
  assert.equal((await approve(3)).statusCode, 200)
  assert.equal((await open(false)).statusCode, 200)
  assert.equal((await submit('third@example.test')).statusCode, 409)
  assert.ok((await state()).invitation)
  const list = await app.inject({ url: adminRoot, headers: headers(ADMIN) })
  assert.equal(list.json<{ requests: unknown[] }>().requests.length, 1)
})
