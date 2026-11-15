import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  LocalProfileAvatarStorage,
  type ProfileAvatarStorage,
} from './profile-avatar.storage.js'
import { MemorySessionRepository } from './session.repository.memory.js'
import { SessionService } from './session.service.js'

const context = { actorUserId: undefined, workspaceId: undefined, auth: null }

void test('keeps the committed avatar when obsolete file cleanup fails', async (t) => {
  t.mock.method(console, 'warn', () => undefined)
  const repository = new MemorySessionRepository()
  const original = await repository.resolve(context)
  await repository.updateUserProfile(original, {
    displayName: 'Avatar test',
    avatarUrl: '/api/v1/profile-assets/old.png',
  })
  const deleted: string[] = []
  const storage: ProfileAvatarStorage = {
    storeProfileAvatar: () => Promise.resolve('/api/v1/profile-assets/new.png'),
    deleteProfileAvatar(value) {
      deleted.push(value)
      return Promise.reject(new Error('storage unavailable'))
    },
  }
  const service = new SessionService(repository, storage)
  const profile = await service.updateUserProfile(context, {
    displayName: 'Updated',
    avatarDataUrl: 'data:image/png;base64,AQ==',
  })
  assert.equal(profile.avatarUrl, '/api/v1/profile-assets/new.png')
  assert.equal(
    (await repository.resolve(context)).actor.avatarUrl,
    profile.avatarUrl,
  )
  assert.deepEqual(deleted, ['/api/v1/profile-assets/old.png'])
})

void test('preserves an upload when the database write outcome is unknown', async (t) => {
  const repository = new MemorySessionRepository()
  const write = repository.updateUserProfile.bind(repository)
  t.mock.method(
    repository,
    'updateUserProfile',
    async (...args: Parameters<typeof write>) => {
      await write(...args)
      throw new Error('connection lost after commit')
    },
  )
  const deleted: string[] = []
  const service = new SessionService(repository, {
    storeProfileAvatar: () =>
      Promise.resolve('/api/v1/profile-assets/staged.png'),
    deleteProfileAvatar(value) {
      deleted.push(value)
      return Promise.resolve()
    },
  })
  await assert.rejects(
    service.updateUserProfile(context, {
      displayName: 'Updated',
      avatarDataUrl: 'data:image/png;base64,AQ==',
    }),
    /connection lost after commit/,
  )
  assert.deepEqual(deleted, [])
  assert.equal(
    (await repository.resolve(context)).actor.avatarUrl,
    '/api/v1/profile-assets/staged.png',
  )
})

void test('concurrent uploads by one user have immutable unique paths', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'planner-avatar-test-'),
  )
  try {
    const storage = new LocalProfileAvatarStorage(directory)
    const urls = await Promise.all(
      [1, 2].map((value) =>
        storage.storeProfileAvatar({
          userId: 'user',
          dataUrl: `data:image/png;base64,${Buffer.from([value]).toString('base64')}`,
        }),
      ),
    )
    assert.notEqual(urls[0], urls[1])
    for (const [index, url] of urls.entries()) {
      assert.deepEqual(
        await readFile(path.join(directory, path.basename(url))),
        Buffer.from([index + 1]),
      )
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
