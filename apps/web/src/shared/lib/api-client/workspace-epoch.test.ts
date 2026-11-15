import { beforeEach, expect, it, vi } from 'vitest'

import { createApiRequester } from './api-client'
import {
  assertOfflineWorkspaceEpoch,
  readWorkspaceWriteEpoch,
  readWorkspaceWriteEpochs,
  rememberWorkspaceWriteEpoch,
} from './workspace-epoch'

beforeEach(() => localStorage.clear())
const response = (epoch: string) =>
  new Response('{}', {
    headers: { 'x-workspace-id': 'w', 'x-workspace-epoch': epoch },
  })
const error = (message: string) => new Error(message)

it('freezes an in-flight client generation, while a fresh client uses the new session snapshot', async () => {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(new Response('{}')))
  const oldClient = createApiRequester(
    { apiBaseUrl: 'https://example.test', workspaceId: 'w' },
    error,
    fetchFn,
  )
  rememberWorkspaceWriteEpoch(response('1'))
  await oldClient.request({ path: '/api/v1/tasks', method: 'POST' })
  expect(
    new Headers(fetchFn.mock.calls[0]?.[1]?.headers).get('x-workspace-epoch'),
  ).toBe('0')
  const current = createApiRequester(
    { apiBaseUrl: 'https://example.test', workspaceId: 'w' },
    error,
    fetchFn,
  )
  await current.request({ path: '/api/v1/tasks', method: 'POST' })
  expect(
    new Headers(fetchFn.mock.calls[1]?.[1]?.headers).get('x-workspace-epoch'),
  ).toBe('1')
})
it('never relabels saved commands, even if local epoch storage was cleared', () => {
  rememberWorkspaceWriteEpoch(response('1'))
  expect(() =>
    assertOfflineWorkspaceEpoch(
      { workspaceId: 'w', writeEpoch: '0' },
      '1',
      error,
    ),
  ).toThrow('восстановлены')
  expect(() =>
    assertOfflineWorkspaceEpoch(
      { workspaceId: 'w', writeEpoch: '1' },
      '1',
      error,
    ),
  ).not.toThrow()
  localStorage.clear()
  expect(() =>
    assertOfflineWorkspaceEpoch(
      { workspaceId: 'w', writeEpoch: '0' },
      '1',
      error,
    ),
  ).toThrow('восстановлены')
})
it('ignores old session reads and malformed metadata', () => {
  rememberWorkspaceWriteEpoch(response('2'))
  rememberWorkspaceWriteEpoch(response('1'))
  rememberWorkspaceWriteEpoch(response('garbage'))
  expect(readWorkspaceWriteEpoch('w')).toBe('2')
})

it('freezes both scopes for transfers and never inherits another actor personal scope', async () => {
  const remember = (epoch: string) =>
    rememberWorkspaceWriteEpoch(
      new Response('{}', {
        headers: {
          'x-workspace-id': 'shared',
          'x-workspace-epoch': '0',
          'x-workspace-actor-id': 'actor-a',
          'x-workspace-epochs': JSON.stringify({
            shared: '0',
            personal: epoch,
          }),
        },
      }),
    )
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(new Response('{}')))
  const config = {
    apiBaseUrl: 'https://example.test',
    actorUserId: 'actor-a',
    workspaceId: 'shared',
  }
  remember('1')
  const old = createApiRequester(config, error, fetchFn)
  remember('2')
  await old.request({
    path: '/api/v1/tasks/task/copy-to-personal',
    method: 'POST',
  })
  await createApiRequester(config, error, fetchFn).request({
    path: '/api/v1/profile',
    method: 'PATCH',
  })
  const scopes = fetchFn.mock.calls.map(
    ([, init]) =>
      JSON.parse(
        new Headers(init?.headers).get('x-workspace-epochs') ?? '{}',
      ) as unknown,
  )
  expect(scopes).toEqual([
    { personal: '1', shared: '0' },
    { personal: '2', shared: '0' },
  ])
  expect(readWorkspaceWriteEpochs('shared', 'actor-b')).toEqual({ shared: '0' })
})
