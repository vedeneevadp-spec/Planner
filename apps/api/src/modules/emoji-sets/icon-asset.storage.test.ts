import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LocalIconAssetStorage } from './icon-asset.storage.js'

void test('reusing an icon ID cannot overwrite or delete an existing asset', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'planner-icons-'))
  try {
    const storage = new LocalIconAssetStorage(directory)
    const input = {
      iconAssetId: 'existing-icon-id',
      iconSetId: 'icon-set',
      workspaceId: 'workspace',
      sortOrder: 0,
    }
    const original = await storage.storeIconAsset({
      ...input,
      dataUrl: `data:image/png;base64,${Buffer.from('original').toString('base64')}`,
    })
    const conflicting = await storage.storeIconAsset({
      ...input,
      dataUrl: `data:image/png;base64,${Buffer.from('different').toString('base64')}`,
    })
    assert.notEqual(original, conflicting)
    assert.equal(
      await readFile(path.join(directory, path.basename(original)), 'utf8'),
      'original',
    )
    // Compensation of a rejected upload must only remove its own file.
    await storage.deleteIconAsset(conflicting)
    assert.equal(
      await readFile(path.join(directory, path.basename(original)), 'utf8'),
      'original',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
