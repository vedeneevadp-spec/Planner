import { z } from 'zod'

export const NATIVE_PLANNER_WIDGET_SNAPSHOT_VERSION = 5
export const NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS = 24
const NATIVE_PLANNER_WIDGET_SOURCE_COUNT = 3

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nonNegativeIntegerSchema = z.number().int().min(0)

export const nativePlannerWidgetTaskVisualToneSchema = z.enum([
  'default',
  'in_progress',
  'overdue',
  'review',
  'urgent',
])

export const nativePlannerWidgetTaskDateBucketSchema = z.enum([
  'future',
  'overdue',
  'today',
  'tomorrow',
  'unscheduled',
])

export const nativePlannerWidgetTaskSourceSchema = z.enum([
  'cleaning',
  'planner',
  'self_care',
])

export const nativePlannerWidgetTaskSchema = z.object({
  canComplete: z.boolean(),
  color: z.string().trim().min(1).default('#8EE7C8'),
  dateBucket: nativePlannerWidgetTaskDateBucketSchema,
  icon: z.string().trim().default(''),
  id: z.string().trim().min(1),
  isOverdue: z.boolean(),
  source: nativePlannerWidgetTaskSourceSchema,
  timeLabel: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1),
  visualTone: nativePlannerWidgetTaskVisualToneSchema,
})

export const nativePlannerWidgetSnapshotSchema = z.object({
  dateKey: dateKeySchema,
  doneTodayCount: nonNegativeIntegerSchema,
  generatedAt: z.string().trim().min(1),
  hiddenCleaningTaskCount: nonNegativeIntegerSchema,
  hiddenSelfCareTaskCount: nonNegativeIntegerSchema,
  hiddenTaskCount: nonNegativeIntegerSchema,
  overdueCount: nonNegativeIntegerSchema,
  tasks: z
    .array(nativePlannerWidgetTaskSchema)
    .max(
      NATIVE_PLANNER_WIDGET_MAX_SNAPSHOT_TASKS *
        NATIVE_PLANNER_WIDGET_SOURCE_COUNT,
    ),
  todayCount: nonNegativeIntegerSchema,
  version: z.literal(NATIVE_PLANNER_WIDGET_SNAPSHOT_VERSION),
})

export type NativePlannerWidgetTask = z.infer<
  typeof nativePlannerWidgetTaskSchema
>
export type NativePlannerWidgetTaskVisualTone = z.infer<
  typeof nativePlannerWidgetTaskVisualToneSchema
>
export type NativePlannerWidgetTaskDateBucket = z.infer<
  typeof nativePlannerWidgetTaskDateBucketSchema
>
export type NativePlannerWidgetTaskSource = z.infer<
  typeof nativePlannerWidgetTaskSourceSchema
>
export type NativePlannerWidgetSnapshot = z.infer<
  typeof nativePlannerWidgetSnapshotSchema
>
