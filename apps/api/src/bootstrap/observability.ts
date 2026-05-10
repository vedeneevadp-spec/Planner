import { randomUUID } from 'node:crypto'

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RawServerDefault,
} from 'fastify'

interface ApiMetricsSnapshot {
  inFlightRequests: number
  requestDurationMsMax: number
  requestDurationMsSum: number
  requestsTotal: number
  responsesByStatus: Map<number, number>
  startedAt: Date
  unhandledErrorsTotal: number
}

const requestStartTimes = new WeakMap<FastifyRequest, bigint>()

export function createRequestId(request: {
  headers: Record<string, string | string[] | undefined>
}): string {
  const incomingRequestId = request.headers['x-request-id']

  if (Array.isArray(incomingRequestId)) {
    return (
      incomingRequestId.find((value) => value.trim().length > 0)?.trim() ??
      randomUUID()
    )
  }

  return incomingRequestId?.trim() || randomUUID()
}

export function registerApiObservability(
  app: FastifyInstance<RawServerDefault>,
): void {
  const metrics: ApiMetricsSnapshot = {
    inFlightRequests: 0,
    requestDurationMsMax: 0,
    requestDurationMsSum: 0,
    requestsTotal: 0,
    responsesByStatus: new Map(),
    startedAt: new Date(),
    unhandledErrorsTotal: 0,
  }

  app.decorate('apiMetrics', metrics)

  app.addHook('onRequest', async (request, reply) => {
    requestStartTimes.set(request, process.hrtime.bigint())
    metrics.inFlightRequests += 1
    reply.header('x-request-id', request.id)
  })

  app.addHook('onResponse', async (request, reply) => {
    const durationMs = readRequestDurationMs(request)
    metrics.inFlightRequests = Math.max(metrics.inFlightRequests - 1, 0)
    metrics.requestsTotal += 1
    metrics.requestDurationMsSum += durationMs
    metrics.requestDurationMsMax = Math.max(
      metrics.requestDurationMsMax,
      durationMs,
    )
    metrics.responsesByStatus.set(
      reply.statusCode,
      (metrics.responsesByStatus.get(reply.statusCode) ?? 0) + 1,
    )
  })

  app.get('/api/metrics', async (_request, reply) => {
    reply.type('text/plain; version=0.0.4; charset=utf-8')

    return renderPrometheusMetrics(metrics)
  })
}

export function createErrorDiagnostics(
  request: FastifyRequest,
  reply: FastifyReply,
): { errorId: string; requestId: string } {
  const errorId = randomUUID()
  const requestId = request.id

  reply.header('x-request-id', requestId)
  reply.header('x-error-id', errorId)

  return { errorId, requestId }
}

export function recordUnhandledRequestError(app: FastifyInstance): void {
  const metrics = app.apiMetrics

  metrics.unhandledErrorsTotal += 1
}

function readRequestDurationMs(request: FastifyRequest): number {
  const startedAt = requestStartTimes.get(request)

  if (!startedAt) {
    return 0
  }

  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

function renderPrometheusMetrics(metrics: ApiMetricsSnapshot): string {
  const lines = [
    '# HELP planner_api_uptime_seconds API process uptime in seconds.',
    '# TYPE planner_api_uptime_seconds gauge',
    `planner_api_uptime_seconds ${Math.max((Date.now() - metrics.startedAt.getTime()) / 1000, 0).toFixed(3)}`,
    '# HELP planner_api_requests_total Total completed HTTP requests.',
    '# TYPE planner_api_requests_total counter',
    `planner_api_requests_total ${metrics.requestsTotal}`,
    '# HELP planner_api_in_flight_requests Current in-flight HTTP requests.',
    '# TYPE planner_api_in_flight_requests gauge',
    `planner_api_in_flight_requests ${metrics.inFlightRequests}`,
    '# HELP planner_api_request_duration_ms_sum Sum of completed HTTP request durations in milliseconds.',
    '# TYPE planner_api_request_duration_ms_sum counter',
    `planner_api_request_duration_ms_sum ${metrics.requestDurationMsSum.toFixed(3)}`,
    '# HELP planner_api_request_duration_ms_max Maximum completed HTTP request duration in milliseconds.',
    '# TYPE planner_api_request_duration_ms_max gauge',
    `planner_api_request_duration_ms_max ${metrics.requestDurationMsMax.toFixed(3)}`,
    '# HELP planner_api_unhandled_errors_total Total unhandled request errors.',
    '# TYPE planner_api_unhandled_errors_total counter',
    `planner_api_unhandled_errors_total ${metrics.unhandledErrorsTotal}`,
    '# HELP planner_api_responses_total Completed HTTP responses by status code.',
    '# TYPE planner_api_responses_total counter',
  ]

  for (const [statusCode, count] of [
    ...metrics.responsesByStatus.entries(),
  ].sort(([leftStatus], [rightStatus]) => leftStatus - rightStatus)) {
    lines.push(`planner_api_responses_total{status="${statusCode}"} ${count}`)
  }

  return `${lines.join('\n')}\n`
}

declare module 'fastify' {
  interface FastifyInstance {
    apiMetrics: ApiMetricsSnapshot
  }
}
