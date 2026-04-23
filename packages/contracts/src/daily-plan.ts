import { z } from 'zod'

export const energyModeSchema = z.enum(['minimum', 'normal', 'maximum'])

export const dailyPlanSchema = z.object({
  id: z.string(),
  userId: z.string(),
  date: z.string(),
  energyMode: energyModeSchema,
  focusTaskIds: z.array(z.string()),
  supportTaskIds: z.array(z.string()),
  routineTaskIds: z.array(z.string()),
  overloadScore: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const dailyPlanUpsertInputSchema = z.object({
  energyMode: energyModeSchema,
  focusTaskIds: z.array(z.string()).default([]),
  supportTaskIds: z.array(z.string()).default([]),
  routineTaskIds: z.array(z.string()).default([]),
})

export const dailyPlanAutoBuildInputSchema = z.object({
  date: z.string(),
  energyMode: energyModeSchema.optional().default('normal'),
})

export const dailyPlanUnloadInputSchema = z.object({
  date: z.string(),
})

export const dailyPlanUnloadSuggestionSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  resource: z.number().int().min(1).max(5),
  action: z.enum(['move_tomorrow', 'remove_from_today', 'move_to_week']),
})

export const dailyPlanUnloadResponseSchema = z.object({
  suggestions: z.array(dailyPlanUnloadSuggestionSchema),
})

export type EnergyMode = z.infer<typeof energyModeSchema>
export type DailyPlan = z.infer<typeof dailyPlanSchema>
export type DailyPlanUpsertInput = z.infer<typeof dailyPlanUpsertInputSchema>
export type DailyPlanAutoBuildInput = z.infer<
  typeof dailyPlanAutoBuildInputSchema
>
export type DailyPlanUnloadInput = z.infer<typeof dailyPlanUnloadInputSchema>
export type DailyPlanUnloadSuggestion = z.infer<
  typeof dailyPlanUnloadSuggestionSchema
>
export type DailyPlanUnloadResponse = z.infer<
  typeof dailyPlanUnloadResponseSchema
>
