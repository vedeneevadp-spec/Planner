import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

export const emojiAssetKindSchema = z.enum(['unicode', 'image'])
export const emojiSetSourceSchema = z.enum(['custom', 'telegram'])
export const emojiSetStatusSchema = z.enum(['active', 'archived'])

export const emojiAssetSchema = z.object({
  emojiSetId: z.string(),
  id: z.string(),
  kind: emojiAssetKindSchema,
  keywords: z.array(z.string()),
  label: z.string().min(1),
  shortcode: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  value: z.string().min(1),
})

export const emojiSetSchema = z.object({
  createdAt: z.string(),
  description: z.string(),
  id: z.string(),
  source: emojiSetSourceSchema,
  status: emojiSetStatusSchema,
  title: z.string().min(1),
})

export const newEmojiAssetInputSchema = z.object({
  id: uuidV7Schema.optional(),
  kind: emojiAssetKindSchema,
  keywords: z.array(z.string()).optional(),
  label: z.string().min(1),
  shortcode: z.string().min(1),
  value: z.string().min(1),
})

export const newEmojiSetInputSchema = z.object({
  description: z.string(),
  id: uuidV7Schema.optional(),
  items: z.array(newEmojiAssetInputSchema).min(1).max(200),
  source: emojiSetSourceSchema.optional(),
  title: z.string().min(1),
})

export type EmojiAsset = z.infer<typeof emojiAssetSchema>
export type EmojiAssetKind = z.infer<typeof emojiAssetKindSchema>
export type EmojiSet = z.infer<typeof emojiSetSchema>
export type EmojiSetSource = z.infer<typeof emojiSetSourceSchema>
export type EmojiSetStatus = z.infer<typeof emojiSetStatusSchema>
export type NewEmojiAssetInput = z.infer<typeof newEmojiAssetInputSchema>
export type NewEmojiSetInput = z.infer<typeof newEmojiSetInputSchema>
