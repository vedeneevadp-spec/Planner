import type { z } from 'zod'

import {
  type AiContextService,
  getScopesForInclude,
  getScopesForSearchTypes,
  HAOTIKA_MCP_READ_SCOPES,
  type HaotikaMcpScope,
  TODAY_CONTEXT_INCLUDE_KEYS,
} from '../ai-context/index.js'
import {
  jsonSchemas,
  type McpToolName,
  outputJsonSchema,
  toolInputSchemas,
} from './mcp-haotika.schemas.js'
import { McpHaotikaError, type McpToolDescriptor } from './mcp-haotika.types.js'

const TOOL_DEFINITIONS: Record<
  McpToolName,
  {
    description: string
    scopes: HaotikaMcpScope[]
    title: string
  }
> = {
  get_overload_context: {
    description:
      'Use this when the user asks Haotika to analyze workload, overload, bottlenecks or suggested focus for a selected period.',
    scopes: [
      'haotika:tasks.read',
      'haotika:calendar.read',
      'haotika:shopping.read',
      'haotika:cleaning.read',
      'haotika:selfcare.read',
      'haotika:stats.read',
    ],
    title: 'Get overload context',
  },
  get_selfcare_context: {
    description:
      'Use this when the user asks Haotika what self-care is planned, completed or missing for a selected period.',
    scopes: ['haotika:selfcare.read'],
    title: 'Get self-care context',
  },
  get_today_context: {
    description:
      'Use this when the user asks what is planned in Haotika today or on a selected day: tasks, calendar, shopping, cleaning, self-care, habits and load stats.',
    scopes: [...HAOTIKA_MCP_READ_SCOPES],
    title: 'Get today context',
  },
  get_week_context: {
    description:
      'Use this when the user asks Haotika for a weekly plan, weekly review, upcoming important items or a week-level overload summary.',
    scopes: [
      'haotika:tasks.read',
      'haotika:calendar.read',
      'haotika:shopping.read',
      'haotika:cleaning.read',
      'haotika:selfcare.read',
      'haotika:stats.read',
    ],
    title: 'Get week context',
  },
  search_planner: {
    description:
      'Use this when the user asks Haotika to find specific planner items by text across tasks, shopping, cleaning, self-care, habits and calendar.',
    scopes: [...HAOTIKA_MCP_READ_SCOPES],
    title: 'Search planner',
  },
}

export const MCP_HAOTIKA_SERVER_INSTRUCTIONS =
  'This MCP server provides read-only access to Haotika planner context. Use tools when the user asks about their day, week, tasks, shopping, cleaning, self-care, habits, overload or planning. Do not claim data that is not returned by tools. Do not modify data. Prefer concise practical summaries.'

export const MCP_HAOTIKA_TOOLS: McpToolDescriptor[] = Object.entries(
  TOOL_DEFINITIONS,
).map(([name, definition]) => {
  const securitySchemes = [
    {
      scopes: definition.scopes,
      type: 'oauth2' as const,
    },
  ]

  return {
    _meta: {
      securitySchemes,
    },
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
    description: definition.description,
    inputSchema: jsonSchemas[name as McpToolName],
    name,
    outputSchema: outputJsonSchema,
    securitySchemes,
    title: definition.title,
  }
})

export function getRequiredScopesForTool(
  name: McpToolName,
  rawInput: unknown,
): HaotikaMcpScope[] {
  if (name === 'get_today_context') {
    const parsed = toolInputSchemas.get_today_context.safeParse(rawInput ?? {})
    const include = parsed.success
      ? (parsed.data.include ?? [...TODAY_CONTEXT_INCLUDE_KEYS])
      : [...TODAY_CONTEXT_INCLUDE_KEYS]

    return getScopesForInclude(include)
  }

  if (name === 'search_planner') {
    const parsed = toolInputSchemas.search_planner.safeParse(rawInput ?? {})
    const types = parsed.success ? parsed.data.types : undefined

    return getScopesForSearchTypes(
      types?.length
        ? types
        : ['tasks', 'calendar', 'shopping', 'cleaning', 'selfcare', 'habits'],
    )
  }

  return TOOL_DEFINITIONS[name].scopes
}

export async function executeMcpTool(input: {
  aiContextService: AiContextService
  arguments: unknown
  name: McpToolName
  userId: string
}): Promise<unknown> {
  switch (input.name) {
    case 'get_overload_context': {
      const parsedInput = parseToolInput(
        toolInputSchemas.get_overload_context,
        input.arguments,
      )

      return input.aiContextService.getOverloadContext({
        ...parsedInput,
        userId: input.userId,
      })
    }
    case 'get_selfcare_context': {
      const parsedInput = parseToolInput(
        toolInputSchemas.get_selfcare_context,
        input.arguments,
      )

      return input.aiContextService.getSelfCareContext({
        ...parsedInput,
        userId: input.userId,
      })
    }
    case 'get_today_context': {
      const parsedInput = parseToolInput(
        toolInputSchemas.get_today_context,
        input.arguments,
      )

      return input.aiContextService.getTodayContext({
        ...parsedInput,
        userId: input.userId,
      })
    }
    case 'get_week_context': {
      const parsedInput = parseToolInput(
        toolInputSchemas.get_week_context,
        input.arguments,
      )

      return input.aiContextService.getWeekContext({
        ...parsedInput,
        userId: input.userId,
      })
    }
    case 'search_planner': {
      const parsedInput = parseToolInput(
        toolInputSchemas.search_planner,
        input.arguments,
      )

      return input.aiContextService.searchPlanner({
        ...parsedInput,
        userId: input.userId,
      })
    }
  }
}

function parseToolInput<T>(schema: z.ZodType<T>, rawInput: unknown): T {
  const parsedInput = schema.safeParse(rawInput ?? {})

  if (!parsedInput.success) {
    const issueMessage =
      parsedInput.error.issues[0]?.message ?? 'Invalid tool input.'

    throw new McpHaotikaError('VALIDATION_ERROR', issueMessage, 400)
  }

  return parsedInput.data
}
