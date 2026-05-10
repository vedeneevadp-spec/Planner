import { z } from 'zod'

export const NATIVE_PLANNER_WIDGET_SNAPSHOT_VERSION = 3
export const NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS = 12

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nonNegativeIntegerSchema = z.number().int().min(0)

export const nativePlannerWidgetTaskVisualToneSchema = z.enum([
  'default',
  'in_progress',
  'overdue',
  'review',
  'urgent',
])

export const nativePlannerWidgetTaskSchema = z.object({
  id: z.string().trim().min(1),
  isOverdue: z.boolean(),
  timeLabel: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  visualTone: nativePlannerWidgetTaskVisualToneSchema,
})

export const nativePlannerWidgetSnapshotSchema = z.object({
  dateKey: dateKeySchema,
  doneTodayCount: nonNegativeIntegerSchema,
  generatedAt: z.string().trim().min(1),
  hiddenTaskCount: nonNegativeIntegerSchema,
  overdueCount: nonNegativeIntegerSchema,
  tasks: z
    .array(nativePlannerWidgetTaskSchema)
    .max(NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS),
  todayCount: nonNegativeIntegerSchema,
  version: z.literal(NATIVE_PLANNER_WIDGET_SNAPSHOT_VERSION),
})

export type NativePlannerWidgetTask = z.infer<
  typeof nativePlannerWidgetTaskSchema
>
export type NativePlannerWidgetTaskVisualTone = z.infer<
  typeof nativePlannerWidgetTaskVisualToneSchema
>
export type NativePlannerWidgetSnapshot = z.infer<
  typeof nativePlannerWidgetSnapshotSchema
>
