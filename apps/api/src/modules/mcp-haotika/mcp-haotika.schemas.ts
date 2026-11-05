import { isValidTimeZone } from '@planner/contracts'
import { z } from 'zod'

import { getAiDateRangeError } from '../ai-context/ai-context.validation.js'
import {
  PLANNER_SEARCH_TYPES,
  TODAY_CONTEXT_INCLUDE_KEYS,
  WEEK_CONTEXT_INCLUDE_KEYS,
} from '../ai-context/index.js'

export const mcpToolNameSchema = z.enum([
  'get_today_context',
  'get_week_context',
  'search_planner',
  'get_overload_context',
  'get_selfcare_context',
])

export type McpToolName = z.infer<typeof mcpToolNameSchema>

const dateSchema = z.iso.date()
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, {
    message: 'timezone must be a valid IANA time zone.',
  })

function validateRange(
  input: { from?: string | undefined; to?: string | undefined },
  context: z.RefinementCtx,
) {
  const message = getAiDateRangeError(input.from, input.to)
  if (message) context.addIssue({ code: 'custom', message, path: ['to'] })
}

export const getTodayContextInputSchema = z
  .object({
    date: dateSchema.optional(),
    include: z
      .array(z.enum(TODAY_CONTEXT_INCLUDE_KEYS))
      .max(TODAY_CONTEXT_INCLUDE_KEYS.length)
      .optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()

export const getWeekContextInputSchema = z
  .object({
    from: dateSchema.optional(),
    include: z
      .array(z.enum(WEEK_CONTEXT_INCLUDE_KEYS))
      .max(WEEK_CONTEXT_INCLUDE_KEYS.length)
      .optional(),
    timezone: timezoneSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict()
  .superRefine(validateRange)

export const searchPlannerInputSchema = z
  .object({
    from: dateSchema.optional(),
    limit: z.number().int().min(1).max(30).optional(),
    query: z.string().trim().max(200),
    status: z.enum(['todo', 'done', 'overdue', 'any']).optional(),
    taskCursor: z.string().min(1).max(8192).optional(),
    timezone: timezoneSchema.optional(),
    to: dateSchema.optional(),
    types: z
      .array(z.enum(PLANNER_SEARCH_TYPES))
      .max(PLANNER_SEARCH_TYPES.length)
      .optional(),
  })
  .strict()
  .superRefine(validateRange)
  .superRefine((input, context) => {
    const tasksOnly = input.types?.length === 1 && input.types[0] === 'tasks'
    if (
      !input.query &&
      !(tasksOnly && input.status === 'done' && input.from && input.to)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A query is required, except when listing completed tasks in a date range.',
        path: ['query'],
      })
    }
    if (input.taskCursor && !tasksOnly) {
      context.addIssue({
        code: 'custom',
        message: 'taskCursor requires types: [tasks].',
        path: ['taskCursor'],
      })
    }
  })

export const getOverloadContextInputSchema = z
  .object({
    from: dateSchema.optional(),
    timezone: timezoneSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict()
  .superRefine(validateRange)

export const getSelfCareContextInputSchema = getOverloadContextInputSchema

export const toolInputSchemas = {
  get_overload_context: getOverloadContextInputSchema,
  get_selfcare_context: getSelfCareContextInputSchema,
  get_today_context: getTodayContextInputSchema,
  get_week_context: getWeekContextInputSchema,
  search_planner: searchPlannerInputSchema,
} satisfies Record<McpToolName, z.ZodTypeAny>

export const jsonSchemas = {
  get_overload_context: {
    additionalProperties: false,
    description:
      'Inclusive date range, at most 31 days. Split longer periods into smaller requests.',
    properties: {
      from: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
      to: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
    },
    type: 'object',
  },
  get_selfcare_context: {
    additionalProperties: false,
    description:
      'Inclusive date range, at most 31 days. Split longer periods into smaller requests.',
    properties: {
      from: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
      to: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
    },
    type: 'object',
  },
  get_today_context: {
    additionalProperties: false,
    properties: {
      date: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      include: {
        items: { enum: TODAY_CONTEXT_INCLUDE_KEYS, type: 'string' },
        maxItems: TODAY_CONTEXT_INCLUDE_KEYS.length,
        type: 'array',
      },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
    },
    type: 'object',
  },
  get_week_context: {
    additionalProperties: false,
    description:
      'Inclusive date range, at most 31 days. Split longer periods into smaller requests.',
    properties: {
      from: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      include: {
        items: { enum: WEEK_CONTEXT_INCLUDE_KEYS, type: 'string' },
        maxItems: WEEK_CONTEXT_INCLUDE_KEYS.length,
        type: 'array',
      },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
      to: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
    },
    type: 'object',
  },
  search_planner: {
    additionalProperties: false,
    description:
      'When both from and to are supplied, the inclusive range must not exceed 31 days.',
    properties: {
      from: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      limit: { maximum: 30, minimum: 1, type: 'integer' },
      query: {
        maxLength: 200,
        type: 'string',
        description:
          'Search text. Use an empty string only with types: [tasks], status: done and both from/to to page through completed task history.',
      },
      status: {
        enum: ['todo', 'done', 'overdue', 'any'],
        type: 'string',
      },
      taskCursor: {
        minLength: 1,
        maxLength: 8192,
        type: 'string',
        description:
          'Continue task-only results with the same query, status, dates and timezone.',
      },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
      to: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      types: {
        items: { enum: PLANNER_SEARCH_TYPES, type: 'string' },
        maxItems: PLANNER_SEARCH_TYPES.length,
        type: 'array',
      },
    },
    required: ['query'],
    type: 'object',
  },
} satisfies Record<McpToolName, Record<string, unknown>>

export const outputJsonSchema = {
  additionalProperties: true,
  type: 'object',
}
