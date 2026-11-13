import * as contracts from '@planner/contracts'
import * as backup from '@planner/contracts/backup'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from 'zod'

import { aliceWebhookRequestSchema } from '../modules/alice/alice.routes.js'
import {
  authorizationFormSchema,
  tokenRequestSchema,
} from '../modules/auth/oauth.routes.js'
import { idsBodySchema } from '../modules/chaos-inbox/chaos-inbox.routes.js'
import { stepsInputSchema } from '../modules/self-care/self-care.routes.js'
import {
  legacyUserPreferencesUpdateInputSchema,
  legacyWorkspaceSettingsUpdateInputSchema,
} from '../modules/session/session.legacy-preferences.js'
import { contractSchema } from './openapi-schema.js'

const userPreferences = contracts.userPreferencesSchema.extend({
  voiceAssistantEnabled: z
    .literal(false)
    .describe('Retired compatibility field; always false.'),
})
const workspaceSettings = contracts.workspaceSettingsSchema.extend({
  wakeWordTrainingModeEnabled: z
    .literal(false)
    .describe('Retired compatibility field; always false.'),
})
const aliceOAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().nonnegative(),
  refresh_token: z.string(),
  token_type: z.literal('Bearer'),
})
const aliceWebhookResponseSchema = z.union([
  z.object({
    response: z.object({
      buttons: z
        .array(
          z.object({
            hide: z.boolean().optional(),
            payload: z.record(z.string(), z.unknown()).optional(),
            title: z.string(),
          }),
        )
        .optional(),
      end_session: z.boolean(),
      text: z.string().max(1024),
    }),
    version: z.literal('1.0'),
  }),
  z.object({ start_account_linking: z.object({}), version: z.literal('1.0') }),
])

// Names stay stable for clients. Shapes, required fields, defaults, enums and
// limits come from the actual validators instead of a second handwritten model.
export const openApiInputContracts = {
  GooglePlayTestingInput: contracts.googlePlayTestingInputSchema,
  GooglePlayTestingReview: contracts.googlePlayTestingReviewSchema,
  GooglePlayTestingSettingsInput: contracts.googlePlayTestingSettingsSchema,
  UserBackupArchiveInput: backup.userBackupArchiveSchema,
  AddEmojiSetItemsInput: contracts.addEmojiSetItemsInputSchema,
  AdminUserRoleUpdateInput: contracts.adminUserRoleUpdateInputSchema,
  AliceOAuthAuthorizeForm: authorizationFormSchema,
  AliceOAuthTokenRequest: tokenRequestSchema,
  AliceWebhookRequest: aliceWebhookRequestSchema,
  AuthPasswordResetConfirmInput: contracts.authPasswordResetConfirmInputSchema,
  AuthPasswordResetRequestInput: contracts.authPasswordResetRequestInputSchema,
  AuthPasswordUpdateInput: contracts.authPasswordUpdateInputSchema,
  AuthRefreshInput: contracts.authRefreshInputSchema,
  AuthSignInInput: contracts.authSignInInputSchema,
  AuthSignOutInput: contracts.authSignOutInputSchema,
  AuthSignUpInput: contracts.authSignUpInputSchema,
  ChaosInboxBulkUpdateInput: contracts.chaosInboxBulkUpdateInputSchema,
  ChaosInboxItemUpdateInput: contracts.chaosInboxItemUpdateInputSchema,
  CleaningSeedInput: contracts.cleaningSeedInputSchema,
  CleaningTaskActionInput: contracts.cleaningTaskActionInputSchema,
  CleaningTaskDeleteInput: contracts.cleaningTaskDeleteInputSchema,
  CleaningTaskUpdateInput: contracts.cleaningTaskUpdateInputSchema,
  CleaningZoneDeleteInput: contracts.cleaningZoneDeleteInputSchema,
  CleaningZoneUpdateInput: contracts.cleaningZoneUpdateInputSchema,
  CreateApiKeyInput: contracts.createApiKeyInputSchema,
  CreateChaosInboxItemsInput: contracts.createChaosInboxItemsInputSchema,
  CreateSharedWorkspaceInput: contracts.createSharedWorkspaceInputSchema,
  DailyPlanAutoBuildInput: contracts.dailyPlanAutoBuildInputSchema,
  DailyPlanUnloadInput: contracts.dailyPlanUnloadInputSchema,
  DailyPlanUpsertInput: contracts.dailyPlanUpsertInputSchema,
  HabitEntryDeleteInput: contracts.habitEntryDeleteInputSchema,
  // The handler takes date from the URL, overriding any body value.
  HabitEntryUpsertInput: contracts.habitEntryUpsertInputSchema.omit({
    date: true,
  }),
  HabitUpdateInput: contracts.habitUpdateInputSchema,
  IdListInput: idsBodySchema,
  LifeSphereUpdateInput: contracts.lifeSphereUpdateInputSchema,
  NewChaosInboxItemInput: contracts.newChaosInboxItemInputSchema,
  NewCleaningTaskInput: contracts.newCleaningTaskInputSchema,
  NewCleaningZoneInput: contracts.newCleaningZoneInputSchema,
  NewEmojiAssetInput: contracts.newEmojiAssetInputSchema,
  NewEmojiSetInput: contracts.newEmojiSetInputSchema,
  NewHabitInput: contracts.newHabitInputSchema,
  NewLifeSphereInput: contracts.newLifeSphereInputSchema,
  NewTaskInput: contracts.newTaskInputSchema,
  NewTaskTemplateInput: contracts.newTaskTemplateInputSchema,
  PublicShoppingCreate: contracts.publicShoppingCreateSchema,
  PublicShoppingUpdate: contracts.publicShoppingUpdateSchema,
  PublicTaskCreate: contracts.publicTaskCreateSchema,
  PublicTaskStatus: contracts.publicTaskStatusSchema,
  PublicTaskUpdate: contracts.publicTaskUpdateSchema,
  PushDeviceUpsertInput: contracts.pushDeviceUpsertInputSchema,
  PushTestNotificationInput: contracts.pushTestNotificationInputSchema,
  SelfCareAppointmentDetailsInput:
    contracts.selfCareAppointmentDetailsInputSchema,
  SelfCareCompletionInput: contracts.selfCareCompletionInputSchema,
  SelfCareCompletionUpdateInput: contracts.selfCareCompletionUpdateInputSchema,
  SelfCareCourseDetailsInput: contracts.selfCareCourseDetailsInputSchema,
  SelfCareDailyStateInput: contracts.selfCareDailyStateInputSchema,
  SelfCareExerciseDetailsInput: contracts.selfCareExerciseDetailsInputSchema,
  SelfCareItemInput: contracts.selfCareItemInputSchema,
  SelfCareItemScheduleInput: contracts.selfCareItemScheduleInputSchema,
  SelfCareItemUpdateInput: contracts.selfCareItemUpdateInputSchema,
  SelfCareMeasurementDetailsInput:
    contracts.selfCareMeasurementDetailsInputSchema,
  SelfCareMedicalDetailsInput: contracts.selfCareMedicalDetailsInputSchema,
  SelfCareMinimumItemInput: contracts.selfCareMinimumItemInputSchema,
  SelfCareMinimumItemsUpdateInput:
    contracts.selfCareMinimumItemsUpdateInputSchema,
  SelfCareOccurrenceMoveInput: contracts.selfCareOccurrenceMoveInputSchema,
  SelfCareOccurrenceSkipInput: contracts.selfCareOccurrenceSkipInputSchema,
  SelfCareOfflineCommand: contracts.selfCareOfflineCommandSchema,
  SelfCareOfflineCommandRequest: contracts.selfCareOfflineCommandRequestSchema,
  SelfCareProcedureDetailsInput: contracts.selfCareProcedureDetailsInputSchema,
  SelfCareRangeInput: contracts.selfCareRangeQuerySchema,
  SelfCareRitualCompletionInput: contracts.selfCareRitualCompletionInputSchema,
  SelfCareRitualStepDraftInput: contracts.selfCareRitualStepDraftInputSchema,
  SelfCareRitualStepInput: contracts.selfCareRitualStepInputSchema,
  SelfCareRitualStepsUpdateInput: stepsInputSchema,
  SelfCareScheduleRuleInput: contracts.selfCareScheduleRuleInputSchema,
  SelfCareSettingsUpdateInput: contracts.selfCareSettingsUpdateInputSchema,
  SelfCareTemplateCreateInput: contracts.selfCareTemplateCreateInputSchema,
  TaskChainCloseInput: contracts.taskChainCloseInputSchema,
  TaskChainDetachInput: contracts.taskChainDetachInputSchema,
  TaskDetailsUpdateInput: contracts.taskDetailsUpdateInputSchema,
  TaskNextStageInput: contracts.taskNextStageInputSchema,
  TaskNextStageUndoInput: contracts.taskNextStageUndoInputSchema,
  TaskPersonalTransferInput: contracts.taskPersonalTransferInputSchema,
  TaskScheduleInput: contracts.taskScheduleInputSchema,
  TaskScheduleUpdateInput: contracts.taskScheduleUpdateInputSchema,
  TaskStatusUpdateInput: contracts.taskStatusUpdateInputSchema,
  UpdateSharedWorkspaceInput: contracts.updateSharedWorkspaceInputSchema,
  UpdateUserProfileInput: contracts.updateUserProfileInputSchema,
  UserBackupRestoreRequest: backup.userBackupRestoreRequestSchema,
  UserPreferencesUpdateInput: legacyUserPreferencesUpdateInputSchema,
  WorkspaceInvitationCreateInput:
    contracts.workspaceInvitationCreateInputSchema,
  WorkspaceSettingsUpdateInput: legacyWorkspaceSettingsUpdateInputSchema,
  WorkspaceUserGroupRoleUpdateInput:
    contracts.workspaceUserGroupRoleUpdateInputSchema,
} satisfies Record<string, z.ZodType>

export const openApiOutputContracts = {
  GooglePlayTestingState: contracts.googlePlayTestingStateSchema,
  GooglePlayTestingRequest: contracts.googlePlayTestingRequestSchema,
  GooglePlayTestingAdmin: contracts.googlePlayTestingAdminSchema,
  GooglePlayTestingSettings: contracts.googlePlayTestingSettingsSchema,
  OAuthError: z.object({ error: z.string(), error_description: z.string() }),
  AdminUserListResponse: contracts.adminUserListResponseSchema,
  AdminUserRecord: contracts.adminUserRecordSchema,
  AliceOAuthTokenResponse: aliceOAuthTokenResponseSchema,
  AliceWebhookResponse: aliceWebhookResponseSchema,
  ApiError: contracts.apiErrorSchema,
  ApiKeyListResponse: contracts.apiKeyListResponseSchema,
  ApiKeyRecord: contracts.apiKeyRecordSchema,
  AppRole: contracts.appRoleSchema,
  AssignableAppRole: contracts.assignableAppRoleSchema,
  AssignableWorkspaceGroupRole: contracts.assignableWorkspaceGroupRoleSchema,
  AuthTokenResponse: contracts.authTokenResponseSchema,
  CalendarViewMode: contracts.calendarViewModeSchema,
  ChaosInboxConvertToTaskRecordResponse:
    contracts.chaosInboxConvertToTaskRecordResponseSchema,
  ChaosInboxConvertToTaskRecordResponseList: z.array(
    contracts.chaosInboxConvertToTaskRecordResponseSchema,
  ),
  ChaosInboxCreatedRecordResponse:
    contracts.chaosInboxCreatedRecordResponseSchema,
  ChaosInboxItemRecord: contracts.chaosInboxItemRecordSchema,
  ChaosInboxListRecordResponse: contracts.chaosInboxListRecordResponseSchema,
  CleaningListResponse: contracts.cleaningListResponseSchema,
  CleaningSummary: contracts.cleaningSummarySchema,
  CleaningTaskActionResponse: contracts.cleaningTaskActionResponseSchema,
  CleaningTaskHistoryItemRecord: contracts.cleaningTaskHistoryItemRecordSchema,
  CleaningTaskRecord: contracts.cleaningTaskRecordSchema,
  CleaningTaskStateRecord: contracts.cleaningTaskStateRecordSchema,
  CleaningTaskWithState: contracts.cleaningTaskWithStateSchema,
  CleaningTodayResponse: contracts.cleaningTodayResponseSchema,
  CleaningZoneRecord: contracts.cleaningZoneRecordSchema,
  CreatedApiKeyResponse: contracts.createdApiKeyResponseSchema,
  DailyPlanRecord: contracts.dailyPlanRecordSchema,
  DailyPlanUnloadResponse: contracts.dailyPlanUnloadResponseSchema,
  DailyPlanUnloadSuggestion: contracts.dailyPlanUnloadSuggestionSchema,
  EmojiAssetKind: contracts.emojiAssetKindSchema,
  EmojiAssetRecord: contracts.emojiAssetRecordSchema,
  EmojiSetListResponse: contracts.emojiSetListResponseSchema,
  EmojiSetRecord: contracts.emojiSetRecordSchema,
  EmojiSetSource: contracts.emojiSetSourceSchema,
  EnergyMode: contracts.energyModeSchema,
  HabitEntryRecord: contracts.habitEntryRecordSchema,
  HabitListResponse: contracts.habitListResponseSchema,
  HabitRecord: contracts.habitRecordSchema,
  HabitStats: contracts.habitStatsSchema,
  HabitStatsResponse: contracts.habitStatsResponseSchema,
  HabitTodayItem: contracts.habitTodayItemSchema,
  HabitTodayResponse: contracts.habitTodayResponseSchema,
  HealthResponse: contracts.healthResponseSchema,
  LifeSphereListResponse: contracts.lifeSphereListRecordResponseSchema,
  LifeSphereRecord: contracts.lifeSphereRecordSchema,
  PlannerSearchItem: contracts.plannerSearchItemSchema,
  PlannerSearchResponse: contracts.plannerSearchResponseSchema,
  PushDeviceRecord: contracts.pushDeviceRecordSchema,
  PushTestNotificationResponse: contracts.pushTestNotificationResponseSchema,
  ReceivedWorkspaceInvitationListResponse:
    contracts.receivedWorkspaceInvitationListResponseSchema,
  ReceivedWorkspaceInvitationRecord:
    contracts.receivedWorkspaceInvitationRecordSchema,
  SelfCareAnalyticsResponse: contracts.selfCareAnalyticsResponseSchema,
  SelfCareAppointmentDetails: contracts.selfCareAppointmentDetailsSchema,
  SelfCareCompletion: contracts.selfCareCompletionSchema,
  SelfCareCourseDetails: contracts.selfCareCourseDetailsSchema,
  SelfCareDailyState: contracts.selfCareDailyStateSchema,
  SelfCareDashboardResponse: contracts.selfCareDashboardResponseSchema,
  SelfCareExerciseDetails: contracts.selfCareExerciseDetailsSchema,
  SelfCareExerciseTrend: contracts.selfCareExerciseTrendSchema,
  SelfCareExerciseTrendPoint: contracts.selfCareExerciseTrendPointSchema,
  SelfCareFlexibleGoalProgress: contracts.selfCareFlexibleGoalProgressSchema,
  SelfCareHistoryResponse: contracts.selfCareHistoryResponseSchema,
  SelfCareItem: contracts.selfCareItemSchema,
  SelfCareItemAlternative: contracts.selfCareItemAlternativeSchema,
  SelfCareListResponse: contracts.selfCareListResponseSchema,
  SelfCareMeasurementDetails: contracts.selfCareMeasurementDetailsSchema,
  SelfCareMeasurementTrend: contracts.selfCareMeasurementTrendSchema,
  SelfCareMeasurementTrendPoint: contracts.selfCareMeasurementTrendPointSchema,
  SelfCareMedicalDetails: contracts.selfCareMedicalDetailsSchema,
  SelfCareMinimumItem: contracts.selfCareMinimumItemSchema,
  SelfCareOccurrence: contracts.selfCareOccurrenceSchema,
  SelfCareOccurrenceListResponse: z.array(contracts.selfCareOccurrenceSchema),
  SelfCareOfflineCommandResponse:
    contracts.selfCareOfflineCommandResponseSchema,
  SelfCareOfflineCommandResult: contracts.selfCareOfflineCommandResultSchema,
  SelfCarePlanResponse: contracts.selfCarePlanResponseSchema,
  SelfCareProcedureDetails: contracts.selfCareProcedureDetailsSchema,
  SelfCareRitualStep: contracts.selfCareRitualStepSchema,
  SelfCareRitualStepCompletion: contracts.selfCareRitualStepCompletionSchema,
  SelfCareRitualStepDraft: contracts.selfCareRitualStepDraftSchema,
  SelfCareRitualStepDraftListResponse:
    contracts.selfCareRitualStepDraftListResponseSchema,
  SelfCareScheduleRule: contracts.selfCareScheduleRuleSchema,
  SelfCareSettings: contracts.selfCareSettingsSchema,
  SelfCareSettingsResponse: contracts.selfCareSettingsResponseSchema,
  SelfCareTemplate: contracts.selfCareTemplateSchema,
  SelfCareTemplateListResponse: z.array(contracts.selfCareTemplateSchema),
  SelfCareTodayItem: contracts.selfCareTodayItemSchema,
  SessionActor: contracts.sessionActorSchema,
  SessionResponse: contracts.sessionResponseSchema.extend({
    userPreferences,
    workspaceSettings,
  }),
  SessionWorkspace: contracts.sessionWorkspaceSchema,
  SessionWorkspaceMembership: contracts.sessionWorkspaceMembershipSchema,
  Task: contracts.taskSchema,
  TaskCursorListResponse: contracts.taskCursorListResponseSchema,
  TaskEventListResponse: contracts.taskEventListResponseSchema,
  TaskEventRecord: contracts.taskEventRecordSchema,
  TaskImportance: contracts.taskImportanceSchema,
  TaskListPageResponse: contracts.taskListPageResponseSchema,
  TaskListResponse: contracts.taskListResponseSchema,
  TaskNextStageResponse: contracts.taskNextStageResponseSchema,
  TaskNextStageUndoResponse: contracts.taskNextStageUndoResponseSchema,
  TaskReadModelResponse: contracts.taskReadModelResponseSchema,
  TaskReadModelSource: contracts.taskReadModelSourceSchema,
  TaskRecord: contracts.taskRecordSchema,
  TaskResource: contracts.taskResourceSchema,
  TaskStatus: contracts.taskStatusSchema,
  TaskTemplate: contracts.taskTemplateSchema,
  TaskTemplateListResponse: contracts.taskTemplateListResponseSchema,
  TaskTemplateRecord: contracts.taskTemplateRecordSchema,
  TaskUrgency: contracts.taskUrgencySchema,
  UserBackupArchive: backup.userBackupArchiveSchema,
  UserBackupAsset: backup.userBackupAssetSchema,
  UserBackupPreviewResponse: backup.userBackupPreviewResponseSchema,
  UserBackupRestoreResponse: backup.userBackupRestoreResponseSchema,
  UserBackupRestoreTableResult: backup.userBackupRestoreTableResultSchema,
  UserPreferences: userPreferences,
  UserProfile: contracts.userProfileSchema,
  WeeklySphereStatsRecordResponse:
    contracts.weeklySphereStatsRecordResponseSchema,
  WorkspaceGroupRole: contracts.workspaceGroupRoleSchema,
  WorkspaceInvitationListResponse:
    contracts.workspaceInvitationListResponseSchema,
  WorkspaceInvitationRecord: contracts.workspaceInvitationRecordSchema,
  WorkspaceInvitationStatus: contracts.workspaceInvitationStatusSchema,
  WorkspaceKind: contracts.workspaceKindSchema,
  WorkspaceRole: contracts.workspaceRoleSchema,
  WorkspaceSettings: workspaceSettings,
  WorkspaceUserListResponse: contracts.workspaceUserListResponseSchema,
  WorkspaceUserRecord: contracts.workspaceUserRecordSchema,
} satisfies Record<string, z.ZodType>

type ComponentSchemas = Record<
  keyof typeof openApiInputContracts | keyof typeof openApiOutputContracts,
  OpenAPIV3.SchemaObject
>

export function createComponentSchemas(): ComponentSchemas {
  const schemas = Object.fromEntries([
    ...Object.entries(openApiInputContracts).map(
      ([name, schema]) => [name, contractSchema(schema, 'input')] as const,
    ),
    ...Object.entries(openApiOutputContracts).map(
      ([name, schema]) => [name, contractSchema(schema, 'output')] as const,
    ),
  ]) as ComponentSchemas
  // OpenAPI 3.0 cannot express unconstrained nullable JSON as precisely as Zod.
  const error = schemas.ApiError.properties!.error as OpenAPIV3.SchemaObject
  error.properties!.details = { nullable: true }
  schemas.PublicTaskUpdate.minProperties = 2
  schemas.PublicShoppingUpdate.minProperties = 1
  for (const [name, field] of [
    ['UserPreferencesUpdateInput', 'voiceAssistantEnabled'],
    ['WorkspaceSettingsUpdateInput', 'wakeWordTrainingModeEnabled'],
  ] as const) {
    const property = schemas[name].properties![field] as OpenAPIV3.SchemaObject
    property.deprecated = true
    property.description =
      'Retired compatibility field. Accepted and ignored; the response value is always false.'
  }
  return schemas
}
