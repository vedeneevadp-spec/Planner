import type {
  SelfCareAnalyticsResponse,
  SelfCareCompletion,
  SelfCareCompletionInput,
  SelfCareCompletionUpdateInput,
  SelfCareDailyState,
  SelfCareDailyStateInput,
  SelfCareDashboardResponse,
  SelfCareHistoryResponse,
  SelfCareItem,
  SelfCareItemInput,
  SelfCareItemScheduleInput,
  SelfCareItemUpdateInput,
  SelfCareListResponse,
  SelfCareMinimumItemsUpdateInput,
  SelfCareOccurrence,
  SelfCareOccurrenceMoveInput,
  SelfCareOccurrenceSkipInput,
  SelfCareOfflineCommand,
  SelfCareOfflineCommandRequest,
  SelfCareOfflineCommandResponse,
  SelfCarePlanResponse,
  SelfCareRitualCompletionInput,
  SelfCareRitualStepDraft,
  SelfCareRitualStepDraftInput,
  SelfCareRitualStepDraftListResponse,
  SelfCareRitualStepInput,
  SelfCareSettingsResponse,
  SelfCareSettingsUpdateInput,
  SelfCareTemplate,
  SelfCareTemplateCreateInput,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'

export type StoredSelfCareItemRecord = SelfCareItem
export type StoredSelfCareOccurrenceRecord = SelfCareOccurrence
export type StoredSelfCareCompletionRecord = SelfCareCompletion
export type StoredSelfCareDailyStateRecord = SelfCareDailyState
export interface StoredSelfCareRitualStepDraftRecord extends SelfCareRitualStepDraft {
  userId: string
  workspaceId: string
}
export type StoredSelfCareTemplateRecord = SelfCareTemplate

export interface SelfCareReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  clientTimeZone?: string | undefined
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
}

export interface SelfCareWriteContext extends SelfCareReadContext {
  actorUserId: string
}

export interface SelfCareListFilters {
  category?: StoredSelfCareItemRecord['category'] | undefined
  includeArchived?: boolean | undefined
  type?: StoredSelfCareItemRecord['type'] | undefined
}

export interface CreateSelfCareItemCommand {
  context: SelfCareWriteContext
  input: SelfCareItemInput
}

export interface UpdateSelfCareItemCommand {
  context: SelfCareWriteContext
  input: SelfCareItemUpdateInput
  itemId: string
}

export interface ArchiveSelfCareItemCommand {
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  itemId: string
}

export interface RestoreSelfCareItemCommand {
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  itemId: string
}

export interface DeleteSelfCareItemCommand {
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  itemId: string
}

export interface GenerateSelfCareOccurrencesCommand {
  context: SelfCareWriteContext
  from: string
  to: string
}

export interface ScheduleSelfCareItemCommand {
  context: SelfCareWriteContext
  existingOccurrenceId?: string | undefined
  expectedOccurrenceVersion?: number | undefined
  expectedVersion?: number | undefined
  input: SelfCareItemScheduleInput
  itemId: string
  occurrenceId?: string | undefined
  strictInsert?: boolean | undefined
}

export interface GetSelfCareDashboardCommand {
  context: SelfCareReadContext
  date: string
}

export interface GetSelfCarePlanCommand {
  context: SelfCareReadContext
  from: string
  to: string
}

export interface GetSelfCareOccurrencesCommand {
  context: SelfCareReadContext
  from: string
  to: string
}

export interface CompleteSelfCareOccurrenceCommand {
  completionId?: string | undefined
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareRitualCompletionInput
  occurrenceId: string
}

export interface CompleteSelfCareItemNowCommand {
  completionId?: string | undefined
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareRitualCompletionInput
  itemId: string
}

export interface CompleteFlexibleGoalCommand {
  completionId?: string | undefined
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareCompletionInput
  itemId: string
}

export interface CompleteCourseSessionCommand {
  completionId?: string | undefined
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareCompletionInput
  itemId: string
}

export interface UpdateSelfCareCompletionCommand {
  completionId: string
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareCompletionUpdateInput
}

export interface MoveSelfCareOccurrenceCommand {
  actedAt?: string | undefined
  completionId?: string | undefined
  context: SelfCareWriteContext
  expectedItemId?: string | undefined
  expectedVersion?: number | undefined
  input: SelfCareOccurrenceMoveInput
  occurrenceId: string
}

export interface SkipSelfCareOccurrenceCommand {
  actedAt?: string | undefined
  completionId?: string | undefined
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareOccurrenceSkipInput
  occurrenceId: string
}

export interface CancelSelfCareOccurrenceCommand {
  actedAt?: string | undefined
  completionId?: string | undefined
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  occurrenceId: string
}

export interface UpsertSelfCareDailyStateCommand {
  context: SelfCareWriteContext
  date: string
  input: SelfCareDailyStateInput
  expectedVersion?: number | null | undefined
}

export interface UpdateSelfCareSettingsCommand {
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareSettingsUpdateInput
}

export interface ToggleSelfCareGentleModeCommand {
  context: SelfCareWriteContext
  date: string
}

export interface UpdateSelfCareMinimumItemsCommand {
  context: SelfCareWriteContext
  expectedVersion?: number | undefined
  input: SelfCareMinimumItemsUpdateInput
}

export interface UpdateSelfCareRitualStepsCommand {
  context: SelfCareWriteContext
  itemId: string
  steps: SelfCareRitualStepInput[]
}

export interface GetSelfCareRitualStepDraftsCommand {
  context: SelfCareReadContext
  date: string
}

export interface UpsertSelfCareRitualStepDraftCommand {
  context: SelfCareWriteContext
  expectedVersion?: number | null | undefined
  input: SelfCareRitualStepDraftInput
}

export interface DeleteSelfCareRitualStepDraftCommand {
  context: SelfCareWriteContext
  date: string
  itemId: string
  occurrenceId: string | null
  expectedVersion?: number | undefined
}

export interface ExecuteSelfCareOfflineCommand {
  context: SelfCareWriteContext
  dispatchCommand?: SelfCareOfflineCommand | undefined
  request: SelfCareOfflineCommandRequest
}

export type ExecuteSelfCareOfflineCommandResult = SelfCareOfflineCommandResponse

export interface CreateSelfCareItemFromTemplateCommand {
  context: SelfCareWriteContext
  input: SelfCareTemplateCreateInput
  templateId: string
}

export type SelfCareListResult = SelfCareListResponse
export type SelfCareDashboardResult = SelfCareDashboardResponse
export type SelfCarePlanResult = SelfCarePlanResponse
export type SelfCareRitualStepDraftListResult =
  SelfCareRitualStepDraftListResponse
export type SelfCareHistoryResult = SelfCareHistoryResponse
export type SelfCareAnalyticsResult = SelfCareAnalyticsResponse
export type SelfCareSettingsResult = SelfCareSettingsResponse
