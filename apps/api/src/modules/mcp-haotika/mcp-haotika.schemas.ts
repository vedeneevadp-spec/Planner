import { z } from 'zod'

import {
  PLANNER_SEARCH_TYPES,
  TODAY_CONTEXT_INCLUDE_KEYS,
} from '../ai-context/index.js'

export const mcpToolNameSchema = z.enum([
  'get_today_context',
  'get_week_context',
  'search_planner',
  'get_overload_context',
  'get_selfcare_context',
])

export type McpToolName = z.infer<typeof mcpToolNameSchema>

export const getTodayContextInputSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    include: z.array(z.enum(TODAY_CONTEXT_INCLUDE_KEYS)).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()

export const getWeekContextInputSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    include: z.array(z.string().trim().min(1).max(40)).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()

export const searchPlannerInputSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    limit: z.number().int().min(1).max(30).optional(),
    query: z.string().trim().min(1).max(200),
    status: z.enum(['todo', 'done', 'overdue', 'any']).optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    types: z.array(z.enum(PLANNER_SEARCH_TYPES)).optional(),
  })
  .strict()

export const getOverloadContextInputSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()

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
    properties: {
      from: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
      to: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
    },
    type: 'object',
  },
  get_selfcare_context: {
    additionalProperties: false,
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
        type: 'array',
      },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
    },
    type: 'object',
  },
  get_week_context: {
    additionalProperties: false,
    properties: {
      from: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      include: {
        items: { maxLength: 40, minLength: 1, type: 'string' },
        type: 'array',
      },
      timezone: { maxLength: 100, minLength: 1, type: 'string' },
      to: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
    },
    type: 'object',
  },
  search_planner: {
    additionalProperties: false,
    properties: {
      from: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      limit: { maximum: 30, minimum: 1, type: 'integer' },
      query: { maxLength: 200, minLength: 1, type: 'string' },
      status: {
        enum: ['todo', 'done', 'overdue', 'any'],
        type: 'string',
      },
      to: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', type: 'string' },
      types: {
        items: { enum: PLANNER_SEARCH_TYPES, type: 'string' },
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
