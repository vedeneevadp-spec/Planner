import { z } from 'zod'

import { uuidV7Schema } from './uuid.js'

const nullableStringWithDefault = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null)

export const lifeSphereSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1),
  color: nullableStringWithDefault,
  icon: nullableStringWithDefault,
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const newLifeSphereInputSchema = z.object({
  id: uuidV7Schema.optional(),
  name: z.string().trim().min(1),
  color: nullableStringWithDefault,
  icon: nullableStringWithDefault,
})

export const lifeSphereUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    color: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.color !== undefined ||
      value.icon !== undefined ||
      value.isActive !== undefined ||
      value.sortOrder !== undefined,
    'At least one life sphere field must be provided.',
  )

export const sphereHealthSchema = z.enum(['healthy', 'warning', 'abandoned'])

export const sphereStatsWeeklySchema = z.object({
  sphereId: z.string(),
  plannedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  totalResource: z.number().int().nonnegative(),
  lastActivityAt: z.string().nullable(),
  health: sphereHealthSchema,
  weeklyShare: z.number().int().min(0).max(100),
})

export const weeklySphereStatsResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  spheres: z.array(lifeSphereSchema),
  stats: z.array(sphereStatsWeeklySchema),
})

export const lifeSphereListResponseSchema = z.array(lifeSphereSchema)

export type LifeSphere = z.infer<typeof lifeSphereSchema>
export type NewLifeSphereInput = z.infer<typeof newLifeSphereInputSchema>
export type LifeSphereUpdateInput = z.infer<typeof lifeSphereUpdateInputSchema>
export type SphereHealth = z.infer<typeof sphereHealthSchema>
export type SphereStatsWeekly = z.infer<typeof sphereStatsWeeklySchema>
export type WeeklySphereStatsResponse = z.infer<
  typeof weeklySphereStatsResponseSchema
>
