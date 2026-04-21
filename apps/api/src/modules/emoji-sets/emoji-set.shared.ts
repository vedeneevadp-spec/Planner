import {
  generateUuidV7,
  type NewEmojiAssetInput,
  type NewEmojiSetInput,
} from '@planner/contracts'

import type {
  StoredEmojiAssetRecord,
  StoredEmojiSetRecord,
} from './emoji-set.model.js'

export interface NormalizedEmojiAssetInput extends NewEmojiAssetInput {
  keywords: string[]
  label: string
  shortcode: string
  value: string
}

export interface NormalizedEmojiSetInput extends NewEmojiSetInput {
  description: string
  items: NormalizedEmojiAssetInput[]
  source: 'custom' | 'telegram'
  title: string
}

export function normalizeEmojiSetInput(
  input: NewEmojiSetInput,
): NormalizedEmojiSetInput {
  return {
    ...input,
    description: input.description.trim(),
    items: input.items.map(normalizeEmojiAssetInput),
    source: input.source ?? 'custom',
    title: input.title.trim(),
  }
}

export function normalizeEmojiAssetInput(
  input: NewEmojiAssetInput,
): NormalizedEmojiAssetInput {
  return {
    ...input,
    keywords: normalizeKeywords(input.keywords ?? []),
    label: input.label.trim(),
    shortcode: normalizeShortcode(input.shortcode),
    value: input.value.trim(),
  }
}

export function createStoredEmojiSetRecord(
  input: NewEmojiSetInput,
  options: {
    id?: string
    now?: string
    workspaceId: string
  },
): StoredEmojiSetRecord {
  const now = options.now ?? new Date().toISOString()
  const normalizedInput = normalizeEmojiSetInput(input)
  const emojiSetId = normalizedInput.id ?? options.id ?? generateUuidV7()

  return {
    createdAt: now,
    deletedAt: null,
    description: normalizedInput.description,
    id: emojiSetId,
    items: normalizedInput.items.map((item, index) =>
      createStoredEmojiAssetRecord(item, {
        emojiSetId,
        now,
        sortOrder: index,
        workspaceId: options.workspaceId,
      }),
    ),
    source: normalizedInput.source,
    status: 'active',
    title: normalizedInput.title,
    updatedAt: now,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function createStoredEmojiAssetRecord(
  input: NormalizedEmojiAssetInput,
  options: {
    emojiSetId: string
    now?: string
    sortOrder: number
    workspaceId: string
  },
): StoredEmojiAssetRecord {
  const now = options.now ?? new Date().toISOString()

  return {
    createdAt: now,
    deletedAt: null,
    emojiSetId: options.emojiSetId,
    id: input.id ?? generateUuidV7(),
    keywords: input.keywords,
    kind: input.kind,
    label: input.label,
    shortcode: input.shortcode,
    sortOrder: options.sortOrder,
    updatedAt: now,
    value: input.value,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function compareStoredEmojiSets(
  left: StoredEmojiSetRecord,
  right: StoredEmojiSetRecord,
): number {
  if (left.title !== right.title) {
    return left.title.localeCompare(right.title)
  }

  if (left.createdAt === right.createdAt) {
    return 0
  }

  return left.createdAt < right.createdAt ? -1 : 1
}

export function compareStoredEmojiAssets(
  left: StoredEmojiAssetRecord,
  right: StoredEmojiAssetRecord,
): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder
  }

  return left.label.localeCompare(right.label)
}

export function sortStoredEmojiSets(
  emojiSets: StoredEmojiSetRecord[],
): StoredEmojiSetRecord[] {
  return [...emojiSets]
    .map((emojiSet) => ({
      ...emojiSet,
      items: [...emojiSet.items].sort(compareStoredEmojiAssets),
    }))
    .sort(compareStoredEmojiSets)
}

export function buildEmojiSetSlug(title: string, emojiSetId: string): string {
  const baseSlug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'emoji-set'

  return `${baseSlug}-${emojiSetId.slice(0, 8)}`
}

function normalizeShortcode(value: string): string {
  return value
    .trim()
    .replace(/^:+|:+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeKeywords(keywords: string[]): string[] {
  return [
    ...new Set(
      keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean),
    ),
  ]
}
