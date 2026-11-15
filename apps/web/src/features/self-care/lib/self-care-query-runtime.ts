import {
  generateUuidV7,
  type HabitTodayResponse,
  type SelfCareCompletion,
  type SelfCareCompletionUpdateInput,
  type SelfCareDashboardResponse,
  type SelfCareHistoryResponse,
  type SelfCareItem,
  type SelfCareItemInput,
  type SelfCareItemScheduleInput,
  type SelfCareItemUpdateInput,
  type SelfCareListResponse,
  type SelfCareOccurrence,
  type SelfCareOfflineCommand,
  type SelfCareOfflineCommandResult,
  type SelfCarePlanResponse,
  type SelfCareRitualStepDraftListResponse,
  type SelfCareSettingsResponse,
  type SelfCareTemplate,
  type SelfCareTemplateCreateInput,
  type SelfCareTodayItem,
  type SessionResponse,
} from '@planner/contracts'
import { type QueryClient } from '@tanstack/react-query'
import { ZodError } from 'zod'

import { isBrowserRetryableOfflineError } from '@/shared/lib/offline-sync'

import {
  commitSelfCareOfflineMutationResult,
  completeSelfCareOfflineMutation,
  createSelfCareCacheKey,
  enqueueSelfCareOfflineMutation,
  getSelfCareOfflineStorageHealth,
  getSelfCareOfflineWorkspaceWriteGeneration,
  isSelfCareOccurrenceClosedConflict,
  isSelfCareOfflineStorageAvailable,
  isSelfCareOfflineWorkspaceWriteGenerationCurrent,
  listSelfCareOfflineMutations,
  loadCachedSelfCareRead,
  loadConfirmedSelfCareCachedScopes,
  loadProjectedCachedSelfCareRead,
  probeSelfCareOfflineStorage,
  rebaseSelfCareOfflineMutations,
  reportSelfCareOfflineStorageFailure,
  saveCachedSelfCareRead,
  type SelfCareCachedRead,
  type SelfCareOfflineMutationRecord,
  type SelfCareOfflineOverlay,
} from './offline-self-care-store'
import { type SelfCareApiClient, SelfCareApiError } from './self-care-api'
import {
  createOptimisticSelfCareResult,
  findSelfCareCompletion,
  findSelfCareItem,
  findSelfCareOccurrence,
  SelfCareOfflineBaseUnavailableError,
  type SelfCareOptimisticSource,
} from './self-care-offline-command'
import {
  getSelfCareCommandEntityKeys,
  getSelfCareResultEntityKeys,
  projectSelfCareCachedRead,
  projectSelfCareRead,
} from './self-care-offline-projection'
import { drainSelfCareOfflineQueue } from './self-care-offline-sync'
import type { SelfCareApiContext } from './useSelfCare'
export interface OccurrenceMutationVariables<TInput> {
  input?: TInput | undefined
  occurrenceId: string
  skipInvalidation?: boolean | undefined
}

export interface RequiredOccurrenceMutationVariables<TInput> {
  input: TInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  occurrenceId: string
  replacementInput?: SelfCareItemScheduleInput | undefined
  skipInvalidation?: boolean | undefined
}

export interface ItemCompletionVariables<TInput> {
  input?: TInput | undefined
  itemId: string
}

export interface CompletionUpdateVariables {
  completionId: string
  input: SelfCareCompletionUpdateInput
}

export interface ItemScheduleVariables {
  existingOccurrenceId?: string | undefined
  input: SelfCareItemScheduleInput
  invalidationScopes?: readonly SelfCareQueryScope[] | undefined
  itemId: string
  skipInvalidation?: boolean | undefined
}

export interface ItemUpdateVariables {
  entry?: SelfCareTodayItem | undefined
  input: SelfCareItemUpdateInput
  itemId: string
  moveNote?: string | undefined
  scheduleInput?: SelfCareItemScheduleInput | undefined
  skipInvalidation?: boolean | undefined
}

export interface CreateItemVariables {
  input: SelfCareItemInput
  scheduleInput?: SelfCareItemScheduleInput | undefined
  skipInvalidation?: boolean | undefined
}

export interface CreateFromTemplateVariables {
  input?: SelfCareTemplateCreateInput | undefined
  scheduleInput?: SelfCareItemScheduleInput | undefined
  templateId: string
}

export type SelfCareQueryScope =
  | 'analytics'
  | 'dashboard'
  | 'history'
  | 'items'
  | 'plan'
  | 'ritual-step-drafts'
  | 'settings'
  | 'templates'

export type SelfCareRefetchType = 'active' | 'all' | 'inactive' | 'none'

export interface SelfCareInvalidationOptions {
  refetchType?: SelfCareRefetchType | undefined
  skipInvalidation?: boolean | undefined
}

export const SELF_CARE_ITEM_CHANGE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'items',
  'plan',
  'history',
  'analytics',
]

export const SELF_CARE_OCCURRENCE_CHANGE_SCOPES: readonly SelfCareQueryScope[] =
  ['dashboard', 'plan', 'history', 'analytics']

export const SELF_CARE_COMPLETION_CHANGE_SCOPES: readonly SelfCareQueryScope[] =
  ['dashboard', 'items', 'plan', 'history', 'analytics', 'ritual-step-drafts']

export const SELF_CARE_SETTINGS_CHANGE_SCOPES: readonly SelfCareQueryScope[] = [
  'dashboard',
  'settings',
]

export const SELF_CARE_STALE_ONLY_INVALIDATION = {
  refetchType: 'none',
} satisfies SelfCareInvalidationOptions

export const selfCareInFlightCommands = new Map<string, Promise<unknown>>()

export const selfCareCommandTails = new Map<string, Promise<void>>()

export const SELF_CARE_API_UNAVAILABLE_MESSAGE =
  'Сейчас не удалось надёжно сохранить изменение. Проверь доступ к профилю или подключение и попробуй снова.'

export const SELF_CARE_NETWORK_ERROR_MESSAGE =
  'Не удалось связаться с сервером, и сохранить изменение на устройстве тоже не получилось. Проверь подключение и попробуй снова.'

export class SelfCareApiUnavailableError extends Error {
  constructor() {
    super(SELF_CARE_API_UNAVAILABLE_MESSAGE)
    this.name = 'SelfCareApiUnavailableError'
  }
}

export declare const selfCareQueryOwnerIdBrand: unique symbol

export type SelfCareQueryOwnerId = string & {
  readonly [selfCareQueryOwnerIdBrand]: true
}

export function createSelfCareQueryOwnerId(
  workspaceId: string,
  actorUserId: string,
): SelfCareQueryOwnerId {
  return JSON.stringify([workspaceId, actorUserId]) as SelfCareQueryOwnerId
}

export function isSelfCareApiUnavailableError(
  error: unknown,
): error is SelfCareApiUnavailableError {
  return (
    error instanceof SelfCareApiUnavailableError ||
    (error instanceof Error &&
      error.message === SELF_CARE_API_UNAVAILABLE_MESSAGE)
  )
}

export function selfCareDashboardQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  date: string,
) {
  return ['self-care', workspaceId, 'dashboard', date] as const
}

export function selfCareItemsQueryKey(workspaceId: SelfCareQueryOwnerId) {
  return ['self-care', workspaceId, 'items'] as const
}

export function selfCarePlanQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'plan', from, to] as const
}

export function selfCareRitualStepDraftsQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  date: string,
) {
  return ['self-care', workspaceId, 'ritual-step-drafts', date] as const
}

export function selfCareHistoryQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'history', from, to] as const
}

export function selfCareAnalyticsQueryKey(
  workspaceId: SelfCareQueryOwnerId,
  from: string,
  to: string,
) {
  return ['self-care', workspaceId, 'analytics', from, to] as const
}

export function selfCareSettingsQueryKey(workspaceId: SelfCareQueryOwnerId) {
  return ['self-care', workspaceId, 'settings'] as const
}

export function selfCareTemplatesQueryKey(workspaceId: SelfCareQueryOwnerId) {
  return ['self-care', workspaceId, 'templates'] as const
}

export const EMPTY_SELF_CARE_OFFLINE_QUEUE_COUNTS = {
  awaitingRefresh: 0,
  closedOccurrenceConflicts: 0,
  conflicted: 0,
  failed: 0,
  pending: 0,
  total: 0,
}

export function getSelfCareErrorMessage(error: unknown): string {
  if (isSelfCareNetworkError(error)) {
    return SELF_CARE_NETWORK_ERROR_MESSAGE
  }

  if (error instanceof ZodError) {
    return 'Не удалось подготовить заботу. Проверь настройки заботы и расписания и попробуй ещё раз.'
  }

  if (error instanceof SelfCareApiError) {
    if (error.code === 'self_care_request_failed') {
      return 'Не удалось выполнить запрос. Повтори попытку.'
    }

    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Не получилось сохранить. Попробуй еще раз.'
}

export interface PersistentSelfCareQueryOptions<TData> {
  cacheParameters?: readonly string[] | undefined
  enabled?: boolean | undefined
  queryKey: (workspaceId: SelfCareQueryOwnerId) => readonly unknown[]
  request: (api: SelfCareApiClient, signal: AbortSignal) => Promise<TData>
  scope: SelfCareQueryScope
  staleTime: number
}

export interface PersistentSelfCareReadState<TData> {
  cacheIdentity: string
  isLoading: boolean
  read: SelfCareCachedRead<TData> | null
}

export interface PersistentSelfCareSyncState {
  cacheIdentity: string
  lastSuccessfulSyncAt: string
}

export function canSessionQueueSelfCare(
  session: SessionResponse | undefined,
): boolean {
  return Boolean(
    session &&
    session.workspace.kind === 'personal' &&
    session.workspace.id === session.workspaceId &&
    session.role !== 'guest' &&
    session.actorUserId === session.actor.id,
  )
}

export interface SelfCareCommandMutationOptions<TData, TVariables> {
  afterResult?:
    | ((
        result: TData,
        context: {
          queryClient: QueryClient
          storageWorkspaceId: string
        },
      ) => Promise<void> | void)
    | undefined
  buildCommand: (
    variables: TVariables,
    source: SelfCareOptimisticSource,
    occurredAt: string,
  ) => unknown
  getInvalidationOptions?:
    ((variables: TVariables) => SelfCareInvalidationOptions) | undefined
  getPendingKey?: ((variables: TVariables) => string) | undefined
  getScopes?:
    ((variables: TVariables) => readonly SelfCareQueryScope[]) | undefined
  invalidationOptions?: SelfCareInvalidationOptions | undefined
  scopes?: readonly SelfCareQueryScope[] | undefined
  selectResult: (result: SelfCareOfflineCommandResult) => TData
}

export function runSelfCareCommandOnce<T>(
  key: string,
  execute: () => Promise<T>,
): Promise<T> {
  const active = selfCareInFlightCommands.get(key)

  if (active) {
    return active as Promise<T>
  }

  const pending = execute().finally(() => {
    if (selfCareInFlightCommands.get(key) === pending) {
      selfCareInFlightCommands.delete(key)
    }
  })
  selfCareInFlightCommands.set(key, pending)
  return pending
}

export function runSelfCareCommandSerially<T>(
  scopeKey: string,
  execute: () => Promise<T>,
): Promise<T> {
  const previous = selfCareCommandTails.get(scopeKey) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(execute)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  selfCareCommandTails.set(scopeKey, tail)
  void tail.finally(() => {
    if (selfCareCommandTails.get(scopeKey) === tail) {
      selfCareCommandTails.delete(scopeKey)
    }
  })
  return result
}

export function serializeSelfCareCommandKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(serializeSelfCareCommandKey).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${serializeSelfCareCommandKey(entry)}`,
      )
      .join(',')}}`
  }

  return JSON.stringify(value) ?? String(value)
}

export async function executeSelfCareCommand(input: {
  command: SelfCareOfflineCommand
  context: SelfCareApiContext
  occurredAt: string
  queryClient: QueryClient
  source: SelfCareOptimisticSource
}): Promise<SelfCareOfflineCommandResult> {
  const { command, context, occurredAt, queryClient, source } = input
  const expectedWriteGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    context.storageWorkspaceId,
  )

  if (!context.canQueueOfflineWrites) {
    throw new SelfCareApiUnavailableError()
  }

  const optimisticResult = createOptimisticSelfCareResult(command, source)

  if (getSelfCareOfflineStorageHealth() === 'unknown') {
    await probeSelfCareOfflineStorage()
  }

  if (!isSelfCareOfflineStorageAvailable()) {
    return executeSelfCareCommandDirectly(queryClient, context, command)
  }

  let queued: SelfCareOfflineMutationRecord

  try {
    const existing = await listSelfCareOfflineMutations(
      context.storageWorkspaceId,
      context.actorUserId,
      expectedWriteGeneration,
    )

    if (existing.length === 0) {
      await persistCurrentSelfCareQueryBases(
        queryClient,
        context,
        expectedWriteGeneration,
      )
    }

    const entityKeys = new Set([
      ...getSelfCareCommandEntityKeys(command),
      ...getSelfCareResultEntityKeys(optimisticResult),
    ])
    const dependsOn = getSelfCareMutationDependencies(existing, entityKeys)
    const operationId = generateUuidV7()
    const record = await enqueueSelfCareOfflineMutation({
      actorUserId: context.actorUserId,
      clientTimeZone: context.clientTimeZone,
      command,
      dependsOn,
      expectedWriteGeneration,
      occurredAt,
      operationId,
      optimisticResult,
      workspaceId: context.storageWorkspaceId,
    })

    if (!record) {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          context.storageWorkspaceId,
          expectedWriteGeneration,
        )
      ) {
        throw new SelfCareApiUnavailableError()
      }

      if (!isSelfCareOfflineStorageAvailable()) {
        return executeSelfCareCommandDirectly(queryClient, context, command)
      }

      throw new SelfCareApiUnavailableError()
    }

    queued = record
  } catch (error) {
    if (reportSelfCareOfflineStorageFailure(error)) {
      return executeSelfCareCommandDirectly(queryClient, context, command)
    }

    throw error
  }

  applySelfCareOverlayToQueries(queryClient, context.workspaceId, {
    command,
    operationId: queued.operationId,
    result: optimisticResult,
    sequence: queued.sequence,
    status: 'pending',
  })

  if (
    context.api &&
    context.readiness.canWriteProtectedData &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  ) {
    scheduleSelfCareOfflineDrain(queryClient, context)
  }

  return optimisticResult
}

export function scheduleSelfCareOfflineDrain(
  queryClient: QueryClient,
  context: SelfCareApiContext,
): void {
  if (!context.api) {
    return
  }

  void drainSelfCareOfflineQueue({
    actorUserId: context.actorUserId,
    api: context.api,
    onApplied: async ({ mutation, response }) => {
      await reconcileAcknowledgedSelfCareMutation(
        mutation,
        response.result,
        context,
      )
    },
    workspaceId: context.storageWorkspaceId,
  })
    .then(() => hydrateSelfCareQueriesFromCache(queryClient, context))
    .catch((error: unknown) => {
      reportSelfCareOfflineStorageFailure(error)
      console.warn('Failed to synchronize queued self-care changes.', error)
    })
}

export async function executeSelfCareCommandDirectly(
  queryClient: QueryClient,
  context: SelfCareApiContext,
  command: SelfCareOfflineCommand,
): Promise<SelfCareOfflineCommandResult> {
  if (
    !context.api ||
    !context.readiness.canWriteProtectedData ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    throw new SelfCareApiUnavailableError()
  }

  const response = await context.api.executeOfflineCommand({
    clientTimeZone: context.clientTimeZone,
    command,
    operationId: generateUuidV7(),
  })
  applySelfCareOverlayToQueries(queryClient, context.workspaceId, {
    command,
    operationId: response.operationId,
    result: response.result,
    sequence: Number.MAX_SAFE_INTEGER,
    status: 'awaiting_refresh',
  })
  return response.result
}

export function getMutationEntityKeys(
  mutation: SelfCareOfflineMutationRecord,
): string[] {
  return [
    ...getSelfCareCommandEntityKeys(mutation.command),
    ...getSelfCareResultEntityKeys(mutation.optimisticResult),
  ]
}

export function getSelfCareMutationDependencies(
  existing: readonly SelfCareOfflineMutationRecord[],
  entityKeys: ReadonlySet<string>,
): string[] {
  const latestByEntity = new Map<string, SelfCareOfflineMutationRecord>()

  for (const mutation of existing) {
    for (const key of getMutationEntityKeys(mutation)) {
      if (entityKeys.has(key)) {
        latestByEntity.set(key, mutation)
      }
    }
  }

  return [...new Set([...latestByEntity.values()].map((value) => value.id))]
}

export interface SelfCareScopeValue {
  cacheKey: string
  data: unknown
  parameters: string[]
  scope: string
}

export function readSelfCareOptimisticSource(
  queryClient: QueryClient,
  context: SelfCareApiContext,
): SelfCareOptimisticSource {
  return buildSelfCareOptimisticSource(
    readSelfCareScopeValues(queryClient, context.workspaceId),
    context.actorUserId,
    context.storageWorkspaceId,
    new Date().toISOString(),
  )
}

export async function hydrateSelfCareOptimisticSourceFromConfirmedCache(
  queryClient: QueryClient,
  context: SelfCareApiContext,
): Promise<SelfCareOptimisticSource | null> {
  const snapshots = await loadConfirmedSelfCareCachedScopes(
    context.storageWorkspaceId,
    context.actorUserId,
  )

  if (!snapshots.length) {
    return null
  }

  await Promise.all(
    snapshots.map(async (snapshot) => {
      const parameters = readSelfCareCacheParameters(
        snapshot.scope,
        snapshot.cacheKey,
      )
      const queryKey = [
        'self-care',
        context.workspaceId,
        snapshot.scope,
        ...parameters,
      ] as const

      if (queryClient.getQueryData(queryKey) !== undefined) {
        return
      }

      const projected = await loadProjectedCachedSelfCareRead(
        context.storageWorkspaceId,
        context.actorUserId,
        snapshot.cacheKey,
        (data, overlay) =>
          projectSelfCareRead(snapshot.scope, parameters, data, overlay),
      )

      if (projected) {
        queryClient.setQueryData(queryKey, projected.data)
      }
    }),
  )

  return readSelfCareOptimisticSource(queryClient, context)
}

export function readSelfCareScopeValues(
  queryClient: QueryClient,
  workspaceId: string,
): SelfCareScopeValue[] {
  return queryClient
    .getQueryCache()
    .findAll({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 'self-care' &&
        query.queryKey[1] === workspaceId,
    })
    .flatMap((query) => {
      const scope = query.queryKey[2]
      const parameters = query.queryKey.slice(3)

      if (
        typeof scope !== 'string' ||
        query.state.data === undefined ||
        !parameters.every((value): value is string => typeof value === 'string')
      ) {
        return []
      }

      return [
        {
          cacheKey: createSelfCareCacheKey(scope, parameters),
          data: query.state.data,
          parameters,
          scope,
        },
      ]
    })
}

export function buildSelfCareOptimisticSource(
  values: readonly SelfCareScopeValue[],
  actorUserId: string,
  workspaceId: string,
  occurredAt: string,
): SelfCareOptimisticSource {
  const dashboards = readScopeData<SelfCareDashboardResponse>(
    values,
    'dashboard',
  )
  const plans = readScopeData<SelfCarePlanResponse>(values, 'plan')
  const histories = readScopeData<SelfCareHistoryResponse>(values, 'history')

  return {
    actorUserId,
    dashboard: mergeSelfCareDashboards(dashboards),
    drafts: readScopeData<SelfCareRitualStepDraftListResponse>(
      values,
      'ritual-step-drafts',
    )[0],
    history: mergeSelfCareHistories(histories),
    list: readScopeData<SelfCareListResponse>(values, 'items')[0],
    occurredAt,
    plan: mergeSelfCarePlans(plans),
    settings: readScopeData<SelfCareSettingsResponse>(values, 'settings')[0],
    templates: readScopeData<SelfCareTemplate[]>(values, 'templates')[0],
    workspaceId,
  }
}

export function readScopeData<TData>(
  values: readonly SelfCareScopeValue[],
  scope: string,
): TData[] {
  return values
    .filter((value) => value.scope === scope)
    .map((value) => value.data as TData)
}

export function mergeSelfCareDashboards(
  values: readonly SelfCareDashboardResponse[],
): SelfCareDashboardResponse | undefined {
  const first = values[0]

  return first
    ? {
        ...first,
        flexibleGoals: uniqueSelfCareEntries(
          values.flatMap((value) => value.flexibleGoals),
        ),
        overdueItems: uniqueSelfCareEntries(
          values.flatMap((value) => value.overdueItems),
        ),
        planningHints: uniqueSelfCareEntries(
          values.flatMap((value) => value.planningHints),
        ),
        todayItems: uniqueSelfCareEntries(
          values.flatMap((value) => value.todayItems),
        ),
        upcomingImportant: uniqueSelfCareEntries(
          values.flatMap((value) => value.upcomingImportant),
        ),
      }
    : undefined
}

export function mergeSelfCarePlans(
  values: readonly SelfCarePlanResponse[],
): SelfCarePlanResponse | undefined {
  const first = values[0]

  return first
    ? {
        ...first,
        courses: uniqueSelfCareEntries(
          values.flatMap((value) => value.courses),
        ),
        medical: uniqueSelfCareEntries(
          values.flatMap((value) => value.medical),
        ),
        occurrences: uniqueSelfCareEntries(
          values.flatMap((value) => value.occurrences),
        ),
        planningHints: uniqueSelfCareEntries(
          values.flatMap((value) => value.planningHints),
        ),
      }
    : undefined
}

export function mergeSelfCareHistories(
  values: readonly SelfCareHistoryResponse[],
): SelfCareHistoryResponse | undefined {
  const first = values[0]

  return first
    ? {
        ...first,
        completions: uniqueById(values.flatMap((value) => value.completions)),
        items: uniqueById(values.flatMap((value) => value.items)),
      }
    : undefined
}

export function uniqueSelfCareEntries(
  values: SelfCareTodayItem[],
): SelfCareTodayItem[] {
  const byKey = new Map<string, SelfCareTodayItem>()

  for (const value of values) {
    byKey.set(value.occurrence?.id ?? `item:${value.item.id}`, value)
  }

  return [...byKey.values()]
}

export function uniqueById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()]
}

export async function persistCurrentSelfCareQueryBases(
  queryClient: QueryClient,
  context: SelfCareApiContext,
  expectedWriteGeneration: number,
): Promise<void> {
  const values = readSelfCareScopeValues(queryClient, context.workspaceId)

  if (!values.length) {
    const confirmed = await loadConfirmedSelfCareCachedScopes(
      context.storageWorkspaceId,
      context.actorUserId,
      expectedWriteGeneration,
    )

    if (confirmed.length > 0) {
      return
    }

    throw new SelfCareOfflineBaseUnavailableError()
  }

  await Promise.all(
    values.map(async (value) => {
      const current = await loadCachedSelfCareRead(
        context.storageWorkspaceId,
        context.actorUserId,
        value.cacheKey,
      )

      if (!current) {
        await saveCachedSelfCareRead(
          context.storageWorkspaceId,
          context.actorUserId,
          value.scope,
          value.cacheKey,
          value.data,
          new Date().toISOString(),
          expectedWriteGeneration,
        )
      }
    }),
  )
}

export function applySelfCareOverlayToQueries(
  queryClient: QueryClient,
  workspaceId: string,
  overlay: SelfCareOfflineOverlay,
): void {
  for (const value of readSelfCareScopeValues(queryClient, workspaceId)) {
    const queryKey = [
      'self-care',
      workspaceId,
      value.scope,
      ...value.parameters,
    ] as const
    queryClient.setQueryData(queryKey, (current: unknown) =>
      current === undefined
        ? current
        : projectSelfCareRead(value.scope, value.parameters, current, overlay),
    )
  }
}

export async function hydrateSelfCareQueriesFromCache(
  queryClient: QueryClient,
  context: Pick<
    SelfCareApiContext,
    'actorUserId' | 'storageWorkspaceId' | 'workspaceId'
  >,
): Promise<void> {
  const values = readSelfCareScopeValues(queryClient, context.workspaceId)
  await Promise.all(
    values.map(async (value) => {
      const read = await loadProjectedCachedSelfCareRead(
        context.storageWorkspaceId,
        context.actorUserId,
        value.cacheKey,
        (data, overlay) =>
          projectSelfCareRead(value.scope, value.parameters, data, overlay),
      )

      if (read) {
        queryClient.setQueryData(
          ['self-care', context.workspaceId, value.scope, ...value.parameters],
          read.data,
        )
      }
    }),
  )
}

export async function reconcileAcknowledgedSelfCareMutation(
  mutation: SelfCareOfflineMutationRecord,
  authoritativeResult: SelfCareOfflineCommandResult,
  context: SelfCareApiContext,
): Promise<void> {
  const committed = await commitSelfCareOfflineMutationResult(
    mutation.id,
    context.storageWorkspaceId,
    context.actorUserId,
    projectSelfCareCachedRead,
    { retainMutation: true },
  )

  if (!committed) {
    throw new Error('Self-care result reconciliation is incomplete.')
  }

  await rebaseSelfCareDependentsAfterAcknowledgement(
    mutation,
    authoritativeResult,
    context,
  )
  await completeSelfCareOfflineMutation(
    mutation.id,
    context.storageWorkspaceId,
    context.actorUserId,
  )
}

export async function rebaseSelfCareDependentsAfterAcknowledgement(
  acknowledged: SelfCareOfflineMutationRecord,
  authoritativeResult: SelfCareOfflineCommandResult,
  context: SelfCareApiContext,
): Promise<void> {
  const mutations = await listSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  const dependentIds = collectSelfCareDependentIds(mutations, acknowledged.id)

  if (!dependentIds.size) {
    return
  }

  const snapshots = await loadConfirmedSelfCareCachedScopes(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  let virtualValues: SelfCareScopeValue[] = snapshots.map((snapshot) => ({
    ...snapshot,
    parameters: readSelfCareCacheParameters(snapshot.scope, snapshot.cacheKey),
  }))
  const completionIdAliases = getCompletionIdAliases(
    acknowledged.optimisticResult,
    authoritativeResult,
  )
  const rebases = []

  for (const mutation of mutations) {
    if (mutation.status === 'conflicted') {
      continue
    }

    if (dependentIds.has(mutation.id)) {
      const source = buildSelfCareOptimisticSource(
        virtualValues,
        context.actorUserId,
        context.storageWorkspaceId,
        mutation.occurredAt,
      )
      const command = rebaseSelfCareCommand(
        mutation.command,
        source,
        completionIdAliases,
      )
      const optimisticResult = createOptimisticSelfCareResult(command, source)
      rebases.push({
        command,
        mutationId: mutation.id,
        optimisticResult,
      })
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command,
        operationId: mutation.operationId,
        result: optimisticResult,
        sequence: mutation.sequence,
        status: 'pending',
      })
      continue
    }

    if (mutation.status !== 'awaiting_refresh') {
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command: mutation.command,
        operationId: mutation.operationId,
        result: mutation.serverResult ?? mutation.optimisticResult,
        sequence: mutation.sequence,
        status: mutation.status,
      })
    }
  }

  await rebaseSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
    rebases,
  )
}

export async function rebaseConflictedSelfCareMutations(
  context: SelfCareApiContext,
): Promise<void> {
  const mutations = await listSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  const excludedRebaseIds = new Set<string>()
  for (const mutation of mutations) {
    if (!isSelfCareOccurrenceClosedConflict(mutation)) {
      continue
    }

    excludedRebaseIds.add(mutation.id)
    for (const dependentId of collectSelfCareDependentIds(
      mutations,
      mutation.id,
    )) {
      excludedRebaseIds.add(dependentId)
    }
  }
  const conflictRoots = mutations.filter(
    (mutation) =>
      mutation.status === 'conflicted' && !excludedRebaseIds.has(mutation.id),
  )

  if (!conflictRoots.length) {
    return
  }

  const rebaseIds = new Set<string>()
  for (const root of conflictRoots) {
    rebaseIds.add(root.id)
    for (const dependentId of collectSelfCareDependentIds(mutations, root.id)) {
      if (!excludedRebaseIds.has(dependentId)) {
        rebaseIds.add(dependentId)
      }
    }
  }

  const snapshots = await loadConfirmedSelfCareCachedScopes(
    context.storageWorkspaceId,
    context.actorUserId,
  )
  let virtualValues: SelfCareScopeValue[] = snapshots.map((snapshot) => ({
    ...snapshot,
    parameters: readSelfCareCacheParameters(snapshot.scope, snapshot.cacheKey),
  }))
  const rebases = []

  for (const mutation of mutations) {
    if (rebaseIds.has(mutation.id)) {
      const source = buildSelfCareOptimisticSource(
        virtualValues,
        context.actorUserId,
        context.storageWorkspaceId,
        mutation.occurredAt,
      )
      const command = rebaseSelfCareCommand(mutation.command, source, new Map())
      const optimisticResult = createOptimisticSelfCareResult(command, source)
      rebases.push({
        command,
        mutationId: mutation.id,
        ...(mutation.status === 'conflicted'
          ? { operationId: generateUuidV7() }
          : {}),
        optimisticResult,
      })
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command,
        operationId: mutation.operationId,
        result: optimisticResult,
        sequence: mutation.sequence,
        status: 'pending',
      })
      continue
    }

    if (mutation.status !== 'conflicted') {
      virtualValues = projectSelfCareScopeValues(virtualValues, {
        command: mutation.command,
        operationId: mutation.operationId,
        result: mutation.serverResult ?? mutation.optimisticResult,
        sequence: mutation.sequence,
        status: mutation.status,
      })
    }
  }

  await rebaseSelfCareOfflineMutations(
    context.storageWorkspaceId,
    context.actorUserId,
    rebases,
  )
}

export function projectSelfCareScopeValues(
  values: readonly SelfCareScopeValue[],
  overlay: SelfCareOfflineOverlay,
): SelfCareScopeValue[] {
  return values.map((value) => ({
    ...value,
    data: projectSelfCareRead(
      value.scope,
      value.parameters,
      value.data,
      overlay,
    ),
  }))
}

export function collectSelfCareDependentIds(
  mutations: readonly SelfCareOfflineMutationRecord[],
  rootId: string,
): Set<string> {
  const resolved = new Set([rootId])
  const dependents = new Set<string>()
  let changed = true

  while (changed) {
    changed = false
    for (const mutation of mutations) {
      if (
        !resolved.has(mutation.id) &&
        mutation.dependsOn.some((dependency) => resolved.has(dependency))
      ) {
        resolved.add(mutation.id)
        dependents.add(mutation.id)
        changed = true
      }
    }
  }

  return dependents
}

export function getCompletionIdAliases(
  optimistic: SelfCareOfflineCommandResult,
  authoritative: SelfCareOfflineCommandResult,
): ReadonlyMap<string, string> {
  return optimistic.kind === 'completion' &&
    authoritative.kind === 'completion' &&
    optimistic.completion.id !== authoritative.completion.id
    ? new Map([[optimistic.completion.id, authoritative.completion.id]])
    : new Map()
}

export function rebaseSelfCareCommand(
  command: SelfCareOfflineCommand,
  source: SelfCareOptimisticSource,
  completionIdAliases: ReadonlyMap<string, string>,
): SelfCareOfflineCommand {
  switch (command.type) {
    case 'create_item':
    case 'create_item_from_template':
      return command
    case 'update_item': {
      const scheduleChange = command.scheduleChange
      return {
        ...command,
        expectedVersion: requireSelfCareItemFromSource(source, command.itemId)
          .version,
        ...(scheduleChange?.type === 'reschedule' ||
        scheduleChange?.type === 'update_schedule'
          ? {
              scheduleChange: {
                ...scheduleChange,
                expectedVersion: requireSelfCareOccurrenceFromSource(
                  source,
                  scheduleChange.occurrenceId,
                ).version,
              },
            }
          : {}),
      }
    }
    case 'archive_item':
    case 'complete_item_now':
    case 'complete_flexible_goal':
    case 'complete_course_session':
      return {
        ...command,
        expectedVersion: requireSelfCareItemFromSource(source, command.itemId)
          .version,
      }
    case 'schedule_item':
      return {
        ...command,
        expectedVersion: requireSelfCareItemFromSource(source, command.itemId)
          .version,
        ...(command.existingOccurrenceId
          ? {
              expectedOccurrenceVersion: requireSelfCareOccurrenceFromSource(
                source,
                command.existingOccurrenceId,
              ).version,
            }
          : {}),
      }
    case 'move_occurrence':
    case 'cancel_occurrence':
    case 'skip_occurrence':
    case 'complete_occurrence':
      return {
        ...command,
        expectedVersion: requireSelfCareOccurrenceFromSource(
          source,
          command.occurrenceId,
        ).version,
      }
    case 'update_completion': {
      const completionId =
        completionIdAliases.get(command.completionId) ?? command.completionId
      return {
        ...command,
        completionId,
        expectedVersion: requireSelfCareCompletionFromSource(
          source,
          completionId,
        ).version,
      }
    }
    case 'update_settings': {
      const settings = source.settings?.settings ?? source.dashboard?.settings

      if (!settings) {
        throw new SelfCareOfflineBaseUnavailableError()
      }

      return { ...command, expectedVersion: settings.version }
    }
    case 'upsert_ritual_step_draft':
      return {
        ...command,
        expectedVersion:
          source.drafts?.drafts.find(
            (draft) =>
              draft.date === command.input.date &&
              draft.itemId === command.input.itemId &&
              draft.occurrenceId === command.input.occurrenceId,
          )?.version ?? null,
      }
  }
}

export function readSelfCareCacheParameters(
  scope: string,
  cacheKey: string,
): string[] {
  const prefix = `${scope}:`
  return cacheKey.startsWith(prefix)
    ? cacheKey
        .slice(prefix.length)
        .split(':')
        .filter(Boolean)
        .map((value) => decodeURIComponent(value))
    : []
}

export function requireSelfCareItemFromSource(
  source: SelfCareOptimisticSource,
  itemId: string,
): SelfCareItem {
  const item = findSelfCareItem(source, itemId)

  if (!item) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return item
}

export function requireSelfCareOccurrenceFromSource(
  source: SelfCareOptimisticSource,
  occurrenceId: string,
): SelfCareOccurrence {
  const occurrence = findSelfCareOccurrence(source, occurrenceId)

  if (!occurrence) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return occurrence
}

export function requireSelfCareCompletionFromSource(
  source: SelfCareOptimisticSource,
  completionId: string,
): SelfCareCompletion {
  const completion = findSelfCareCompletion(source, completionId)

  if (!completion) {
    throw new SelfCareOfflineBaseUnavailableError()
  }

  return completion
}

export function withCommandCompletionTime<
  TInput extends { completedAt?: string | undefined },
>(
  input: TInput | undefined,
  occurredAt: string,
): TInput & { completedAt: string } {
  return {
    ...(input ?? ({} as TInput)),
    completedAt: input?.completedAt ?? occurredAt,
  }
}

export function createReplacementScheduleInput(
  occurrence: SelfCareOccurrence,
  scheduledFor: string,
): SelfCareItemScheduleInput {
  return {
    currency: null,
    note: '',
    place: null,
    price: null,
    reminderOffsetsMinutes: occurrence.reminderOffsetsMinutes,
    scheduledFor,
    scheduledTime: null,
    specialistContact: null,
    specialistName: null,
    timezone: occurrence.reminderTimeZone,
  }
}

export function normalizeSelfCareItemRelationIds<
  TInput extends {
    alternatives?: SelfCareItemInput['alternatives'] | undefined
    scheduleRule?: SelfCareItemInput['scheduleRule'] | undefined
    steps?: SelfCareItemInput['steps'] | undefined
  },
>(
  input: TInput,
  list: SelfCareListResponse | undefined,
  itemId: string,
): TInput {
  const existingSteps = (list?.steps ?? [])
    .filter((step) => step.itemId === itemId)
    .sort((left, right) => left.order - right.order)
  const usedStepIds = new Set<string>()
  const steps = input.steps?.map((step, index) => {
    const existing =
      (step.id
        ? existingSteps.find((candidate) => candidate.id === step.id)
        : (existingSteps.find(
            (candidate) =>
              candidate.title === step.title && !usedStepIds.has(candidate.id),
          ) ?? existingSteps[index])) ?? null
    const id = step.id ?? existing?.id ?? generateUuidV7()
    usedStepIds.add(id)
    return { ...step, id }
  })
  const existingAlternatives = (list?.alternatives ?? []).filter(
    (alternative) => alternative.itemId === itemId,
  )
  const usedAlternativeIds = new Set<string>()
  const alternatives = input.alternatives?.map((alternative, index) => {
    const existing =
      (alternative.id
        ? existingAlternatives.find(
            (candidate) => candidate.id === alternative.id,
          )
        : (existingAlternatives.find(
            (candidate) =>
              candidate.title === alternative.title &&
              !usedAlternativeIds.has(candidate.id),
          ) ?? existingAlternatives[index])) ?? null
    const id = alternative.id ?? existing?.id ?? generateUuidV7()
    usedAlternativeIds.add(id)
    return { ...alternative, id }
  })
  const existingScheduleRule = list?.scheduleRules.find(
    (rule) => rule.itemId === itemId,
  )

  return {
    ...input,
    ...(alternatives ? { alternatives } : {}),
    ...(input.scheduleRule
      ? {
          scheduleRule: {
            ...input.scheduleRule,
            id:
              input.scheduleRule.id ??
              existingScheduleRule?.id ??
              generateUuidV7(),
          },
        }
      : {}),
    ...(steps ? { steps } : {}),
  }
}

export function selectItemResult(
  result: SelfCareOfflineCommandResult,
): SelfCareItem {
  if (result.kind !== 'item') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.item
}

export function selectOccurrenceResult(
  result: SelfCareOfflineCommandResult,
): SelfCareOccurrence {
  if (
    result.kind !== 'occurrence' &&
    result.kind !== 'occurrence_rescheduled'
  ) {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.occurrence
}

export function selectCompletionResult(
  result: SelfCareOfflineCommandResult,
): SelfCareCompletion {
  if (result.kind !== 'completion') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.completion
}

export function selectSettingsResult(
  result: SelfCareOfflineCommandResult,
): SelfCareSettingsResponse {
  if (result.kind !== 'settings') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.value
}

export function selectRitualStepDraftsResult(
  result: SelfCareOfflineCommandResult,
): SelfCareRitualStepDraftListResponse {
  if (result.kind !== 'ritual_step_drafts') {
    throw new Error('Self-care command returned an unexpected result.')
  }

  return result.value
}

export function requireSelfCareApi(
  api: SelfCareApiClient | null,
): SelfCareApiClient {
  if (!api) {
    throw new SelfCareApiUnavailableError()
  }

  return api
}

export function isSelfCareNetworkError(error: unknown): boolean {
  return isBrowserRetryableOfflineError(error)
}

export function normalizeCreateItemVariables(
  variables: SelfCareItemInput | CreateItemVariables,
): CreateItemVariables {
  if (
    typeof variables === 'object' &&
    variables !== null &&
    'input' in variables
  ) {
    return variables
  }

  return { input: variables }
}

export function queueSelfCareInvalidationUnlessSkipped(
  queryClient: QueryClient,
  workspaceId: string,
  scopes: readonly SelfCareQueryScope[],
  options: SelfCareInvalidationOptions = {},
): void {
  if (options.skipInvalidation) {
    return
  }

  queueSelfCareInvalidation(queryClient, workspaceId, scopes, options)
}

export function queueSelfCareInvalidation(
  queryClient: QueryClient,
  workspaceId: string,
  scopes: readonly SelfCareQueryScope[],
  options: SelfCareInvalidationOptions = {},
): void {
  const scopeSet = new Set<SelfCareQueryScope>(scopes)
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    Array.isArray(query.queryKey) &&
    query.queryKey[0] === 'self-care' &&
    query.queryKey[1] === workspaceId &&
    typeof query.queryKey[2] === 'string' &&
    scopeSet.has(query.queryKey[2] as SelfCareQueryScope)

  void queryClient.invalidateQueries(
    options.refetchType
      ? { predicate, refetchType: options.refetchType }
      : { predicate },
  )
}

export async function invalidateMigratedHabitRoutine(
  queryClient: QueryClient,
  workspaceId: string,
  habitId: string | null,
): Promise<void> {
  if (!habitId) {
    return
  }

  queryClient.setQueriesData<HabitTodayResponse>(
    {
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 'habits' &&
        query.queryKey[1] === workspaceId &&
        query.queryKey[2] === 'today',
    },
    (current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.habit.id !== habitId),
          }
        : current,
  )

  await queryClient.invalidateQueries({
    queryKey: ['habits', workspaceId],
  })
}
