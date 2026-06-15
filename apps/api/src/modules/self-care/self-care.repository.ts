import type {
  ArchiveSelfCareItemCommand,
  CancelSelfCareOccurrenceCommand,
  CompleteCourseSessionCommand,
  CompleteFlexibleGoalCommand,
  CompleteSelfCareItemNowCommand,
  CompleteSelfCareOccurrenceCommand,
  CreateSelfCareItemCommand,
  CreateSelfCareItemFromTemplateCommand,
  DeleteSelfCareItemCommand,
  GenerateSelfCareOccurrencesCommand,
  GetSelfCareDashboardCommand,
  GetSelfCareOccurrencesCommand,
  GetSelfCarePlanCommand,
  MoveSelfCareOccurrenceCommand,
  RestoreSelfCareItemCommand,
  ScheduleSelfCareItemCommand,
  SelfCareAnalyticsResult,
  SelfCareDashboardResult,
  SelfCareHistoryResult,
  SelfCareListFilters,
  SelfCareListResult,
  SelfCarePlanResult,
  SelfCareReadContext,
  SelfCareSettingsResult,
  SkipSelfCareOccurrenceCommand,
  StoredSelfCareCompletionRecord,
  StoredSelfCareDailyStateRecord,
  StoredSelfCareItemRecord,
  StoredSelfCareOccurrenceRecord,
  StoredSelfCareTemplateRecord,
  ToggleSelfCareGentleModeCommand,
  UpdateSelfCareItemCommand,
  UpdateSelfCareMinimumItemsCommand,
  UpdateSelfCareRitualStepsCommand,
  UpdateSelfCareSettingsCommand,
  UpsertSelfCareDailyStateCommand,
} from './self-care.model.js'

export interface SelfCareRepository {
  archiveItem: (
    command: ArchiveSelfCareItemCommand,
  ) => Promise<StoredSelfCareItemRecord>
  cancelOccurrence: (
    command: CancelSelfCareOccurrenceCommand,
  ) => Promise<StoredSelfCareOccurrenceRecord>
  completeCourseSession: (
    command: CompleteCourseSessionCommand,
  ) => Promise<StoredSelfCareCompletionRecord>
  completeFlexibleGoal: (
    command: CompleteFlexibleGoalCommand,
  ) => Promise<StoredSelfCareCompletionRecord>
  completeItemNow: (
    command: CompleteSelfCareItemNowCommand,
  ) => Promise<StoredSelfCareCompletionRecord>
  completeOccurrence: (
    command: CompleteSelfCareOccurrenceCommand,
  ) => Promise<StoredSelfCareCompletionRecord>
  createItem: (
    command: CreateSelfCareItemCommand,
  ) => Promise<StoredSelfCareItemRecord>
  createItemFromTemplate: (
    command: CreateSelfCareItemFromTemplateCommand,
  ) => Promise<StoredSelfCareItemRecord>
  deleteItem: (command: DeleteSelfCareItemCommand) => Promise<void>
  disableGentleMode: (
    command: ToggleSelfCareGentleModeCommand,
  ) => Promise<SelfCareSettingsResult>
  enableGentleMode: (
    command: ToggleSelfCareGentleModeCommand,
  ) => Promise<SelfCareSettingsResult>
  generateOccurrences: (
    command: GenerateSelfCareOccurrencesCommand,
  ) => Promise<StoredSelfCareOccurrenceRecord[]>
  getAnalytics: (
    context: SelfCareReadContext,
    from: string,
    to: string,
  ) => Promise<SelfCareAnalyticsResult>
  getDashboard: (
    command: GetSelfCareDashboardCommand,
  ) => Promise<SelfCareDashboardResult>
  getDailyState: (
    context: SelfCareReadContext,
    date: string,
  ) => Promise<StoredSelfCareDailyStateRecord | null>
  getHistory: (
    context: SelfCareReadContext,
    from: string,
    to: string,
  ) => Promise<SelfCareHistoryResult>
  getOccurrences: (
    command: GetSelfCareOccurrencesCommand,
  ) => Promise<StoredSelfCareOccurrenceRecord[]>
  getPlan: (command: GetSelfCarePlanCommand) => Promise<SelfCarePlanResult>
  getSettings: (context: SelfCareReadContext) => Promise<SelfCareSettingsResult>
  listItems: (
    context: SelfCareReadContext,
    filters?: SelfCareListFilters,
  ) => Promise<SelfCareListResult>
  listTemplates: (
    context: SelfCareReadContext,
  ) => Promise<StoredSelfCareTemplateRecord[]>
  moveOccurrence: (
    command: MoveSelfCareOccurrenceCommand,
  ) => Promise<StoredSelfCareOccurrenceRecord>
  restoreItem: (
    command: RestoreSelfCareItemCommand,
  ) => Promise<StoredSelfCareItemRecord>
  scheduleItem: (
    command: ScheduleSelfCareItemCommand,
  ) => Promise<StoredSelfCareOccurrenceRecord>
  skipOccurrence: (
    command: SkipSelfCareOccurrenceCommand,
  ) => Promise<StoredSelfCareOccurrenceRecord>
  updateItem: (
    command: UpdateSelfCareItemCommand,
  ) => Promise<StoredSelfCareItemRecord>
  updateMinimumItems: (
    command: UpdateSelfCareMinimumItemsCommand,
  ) => Promise<SelfCareSettingsResult>
  updateRitualSteps: (
    command: UpdateSelfCareRitualStepsCommand,
  ) => Promise<SelfCareListResult>
  updateSettings: (
    command: UpdateSelfCareSettingsCommand,
  ) => Promise<SelfCareSettingsResult>
  upsertDailyState: (
    command: UpsertSelfCareDailyStateCommand,
  ) => Promise<StoredSelfCareDailyStateRecord>
}
