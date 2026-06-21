import { createHash } from 'node:crypto'

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  McpAuditLogCommand,
  McpAuditLogRepository,
} from './mcp-haotika.types.js'

export class MemoryMcpAuditLogRepository implements McpAuditLogRepository {
  readonly logs: McpAuditLogCommand[] = []

  createLog(command: McpAuditLogCommand): Promise<void> {
    this.logs.push({
      ...command,
      input: redactAuditInput(command.input),
      outputSummary: sanitizeOutputSummary(command.outputSummary),
    })

    return Promise.resolve()
  }
}

export class PostgresMcpAuditLogRepository implements McpAuditLogRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async createLog(command: McpAuditLogCommand): Promise<void> {
    await sql`
      select app.mcp_audit_create_log(
        ${command.userId}::uuid,
        ${command.tokenId}::uuid,
        ${command.toolName},
        ${toJsonbString(redactAuditInput(command.input))}::jsonb,
        ${toJsonbString(sanitizeOutputSummary(command.outputSummary))}::jsonb,
        ${command.ipHash},
        ${command.userAgent}
      )
    `.execute(this.db)
  }
}

export function hashIpAddress(ipAddress: string | undefined): string | null {
  if (!ipAddress) {
    return null
  }

  return createHash('sha256').update(ipAddress).digest('hex')
}

export function createToolOutputSummary(
  output: unknown,
): Record<string, unknown> {
  if (!isRecord(output)) {
    return {}
  }

  return summarizeToolOutput(output)
}

function summarizeToolOutput(
  output: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(readNestedCount(output, ['tasks', 'totalCount']) !== null
      ? { tasksCount: readNestedCount(output, ['tasks', 'totalCount']) }
      : {}),
    ...(readNestedCount(output, ['calendar', 'totalCount']) !== null
      ? {
          calendarEventsCount: readNestedCount(output, [
            'calendar',
            'totalCount',
          ]),
        }
      : {}),
    ...(readNestedCount(output, ['shopping', 'activeCount']) !== null
      ? {
          shoppingActiveCount: readNestedCount(output, [
            'shopping',
            'activeCount',
          ]),
          shoppingItemsCount: readNestedCount(output, [
            'shopping',
            'activeCount',
          ]),
        }
      : {}),
    ...(readNestedCount(output, ['shopping', 'completedCount']) !== null
      ? {
          shoppingCompletedCount: readNestedCount(output, [
            'shopping',
            'completedCount',
          ]),
        }
      : {}),
    ...(readNestedArrayCount(output, ['cleaning', 'tasks']) !== null
      ? {
          cleaningTasksCount: readNestedArrayCount(output, [
            'cleaning',
            'tasks',
          ]),
        }
      : {}),
    ...(readNestedArrayCount(output, ['selfCare', 'remaining']) !== null
      ? {
          selfCareItemsCount: readNestedArrayCount(output, [
            'selfCare',
            'remaining',
          ]),
        }
      : {}),
    ...(readNestedArrayCount(output, ['habits', 'planned']) !== null
      ? { habitsCount: readNestedArrayCount(output, ['habits', 'planned']) }
      : {}),
    ...(typeof output.totalCount === 'number'
      ? { totalCount: output.totalCount }
      : {}),
    ...(typeof output.returnedCount === 'number'
      ? { returnedCount: output.returnedCount }
      : {}),
    ...(isRecord(output.summary) ? compactSummary(output.summary) : {}),
    ...(isRecord(output.counts) ? compactSummary(output.counts) : {}),
  }
}

function compactSummary(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) =>
        typeof value === 'number' ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        value === null,
    ),
  )
}

function sanitizeOutputSummary(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return compactSummary(input)
}

function redactAuditInput(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(redactAuditInput)
  }

  if (!isRecord(input)) {
    return input
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase()

    if (
      normalizedKey.includes('token') ||
      normalizedKey.includes('authorization') ||
      normalizedKey.includes('password') ||
      normalizedKey.includes('secret')
    ) {
      continue
    }

    result[key] = redactAuditInput(value)
  }

  return result
}

function toJsonbString(value: unknown): string {
  return JSON.stringify(isRecord(value) ? value : null)
}

function readNestedCount(
  input: Record<string, unknown>,
  path: [string, string],
): number | null {
  const parent = input[path[0]]

  if (!isRecord(parent)) {
    return null
  }

  const value = parent[path[1]]

  return typeof value === 'number' ? value : null
}

function readNestedArrayCount(
  input: Record<string, unknown>,
  path: [string, string],
): number | null {
  const parent = input[path[0]]

  if (!isRecord(parent)) {
    return null
  }

  const value = parent[path[1]]

  return Array.isArray(value) ? value.length : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
