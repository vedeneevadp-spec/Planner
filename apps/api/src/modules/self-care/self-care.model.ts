import type {
  SelfCareAnalyticsResponse,
  SelfCareCompletion,
  SelfCareCompletionInput,
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
  itemId: string
}

export interface RestoreSelfCareItemCommand {
  context: SelfCareWriteContext
  itemId: string
}

export interface DeleteSelfCareItemCommand {
  context: SelfCareWriteContext
  itemId: string
}

export interface GenerateSelfCareOccurrencesCommand {
  context: SelfCareWriteContext
  from: string
  to: string
}

export interface ScheduleSelfCareItemCommand {
  context: SelfCareWriteContext
  input: SelfCareItemScheduleInput
  itemId: string
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
  context: SelfCareWriteContext
  input: SelfCareRitualCompletionInput
  occurrenceId: string
}

export interface CompleteSelfCareItemNowCommand {
  context: SelfCareWriteContext
  input: SelfCareRitualCompletionInput
  itemId: string
}

export interface CompleteFlexibleGoalCommand {
  context: SelfCareWriteContext
  input: SelfCareCompletionInput
  itemId: string
}

export interface CompleteCourseSessionCommand {
  context: SelfCareWriteContext
  input: SelfCareCompletionInput
  itemId: string
}

export interface MoveSelfCareOccurrenceCommand {
  context: SelfCareWriteContext
  input: SelfCareOccurrenceMoveInput
  occurrenceId: string
}

export interface SkipSelfCareOccurrenceCommand {
  context: SelfCareWriteContext
  input: SelfCareOccurrenceSkipInput
  occurrenceId: string
}

export interface CancelSelfCareOccurrenceCommand {
  context: SelfCareWriteContext
  occurrenceId: string
}

export interface UpsertSelfCareDailyStateCommand {
  context: SelfCareWriteContext
  date: string
  input: SelfCareDailyStateInput
}

export interface UpdateSelfCareSettingsCommand {
  context: SelfCareWriteContext
  input: SelfCareSettingsUpdateInput
}

export interface ToggleSelfCareGentleModeCommand {
  context: SelfCareWriteContext
  date: string
}

export interface UpdateSelfCareMinimumItemsCommand {
  context: SelfCareWriteContext
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
  input: SelfCareRitualStepDraftInput
}

export interface DeleteSelfCareRitualStepDraftCommand {
  context: SelfCareWriteContext
  date: string
  itemId: string
  occurrenceId: string | null
}

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
