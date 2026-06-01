import type { OpenAPIV3 } from 'openapi-types'

import {
  createCleaningContractSchemas,
  createHabitContractSchemas,
} from './openapi-contract-schemas.js'
import {
  genericJsonArraySchema,
  genericJsonObjectSchema,
  nullableRefSchema,
  nullableStringSchema,
  positiveIntegerSchema,
} from './openapi-helpers.js'

export function createComponentSchemas(): Record<
  string,
  OpenAPIV3.SchemaObject
> {
  return {
    ApiError: {
      additionalProperties: false,
      properties: {
        error: {
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
            },
            details: {
              nullable: true,
            },
            message: {
              type: 'string',
            },
          },
          required: ['code', 'message'],
          type: 'object',
        },
      },
      required: ['error'],
      type: 'object',
    },
    JsonObject: genericJsonObjectSchema(),
    AliceOAuthAuthorizeForm: genericJsonObjectSchema(),
    AliceOAuthTokenRequest: genericJsonObjectSchema(),
    AliceOAuthTokenResponse: genericJsonObjectSchema(),
    AliceWebhookRequest: genericJsonObjectSchema(),
    AliceWebhookResponse: genericJsonObjectSchema(),
    AuthPasswordResetConfirmInput: {
      additionalProperties: false,
      properties: {
        password: {
          maxLength: 128,
          minLength: 6,
          type: 'string',
        },
        token: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['password', 'token'],
      type: 'object',
    },
    AuthPasswordResetRequestInput: {
      additionalProperties: false,
      properties: {
        email: {
          format: 'email',
          maxLength: 320,
          type: 'string',
        },
      },
      required: ['email'],
      type: 'object',
    },
    AuthPasswordUpdateInput: {
      additionalProperties: false,
      properties: {
        currentPassword: {
          maxLength: 128,
          minLength: 1,
          type: 'string',
        },
        password: {
          maxLength: 128,
          minLength: 6,
          type: 'string',
        },
      },
      required: ['currentPassword', 'password'],
      type: 'object',
    },
    AuthSignOutInput: {
      allOf: [
        {
          $ref: '#/components/schemas/AuthRefreshInput',
        },
      ],
    },
    ChaosInboxBulkUpdateInput: genericJsonObjectSchema(),
    ChaosInboxConvertToTaskRecordResponse: genericJsonObjectSchema(),
    ChaosInboxConvertToTaskRecordResponseList: genericJsonArraySchema(
      'ChaosInboxConvertToTaskRecordResponse',
    ),
    ChaosInboxCreatedRecordResponse: genericJsonObjectSchema(),
    ChaosInboxItemRecord: genericJsonObjectSchema(),
    ChaosInboxItemUpdateInput: genericJsonObjectSchema(),
    ChaosInboxListRecordResponse: genericJsonObjectSchema(),
    ...createCleaningContractSchemas(),
    CreateChaosInboxItemsInput: genericJsonObjectSchema(),
    DailyPlanAutoBuildInput: genericJsonObjectSchema(),
    DailyPlanRecord: genericJsonObjectSchema(),
    DailyPlanUnloadInput: genericJsonObjectSchema(),
    DailyPlanUnloadResponse: genericJsonObjectSchema(),
    DailyPlanUpsertInput: genericJsonObjectSchema(),
    ...createHabitContractSchemas(),
    IdListInput: {
      additionalProperties: false,
      properties: {
        ids: {
          items: {
            minLength: 1,
            type: 'string',
          },
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
      },
      required: ['ids'],
      type: 'object',
    },
    LifeSphereListResponse: genericJsonArraySchema('LifeSphereRecord'),
    LifeSphereRecord: genericJsonObjectSchema(),
    LifeSphereUpdateInput: genericJsonObjectSchema(),
    NewLifeSphereInput: genericJsonObjectSchema(),
    PushDeviceRecord: genericJsonObjectSchema(),
    PushDeviceUpsertInput: genericJsonObjectSchema(),
    PushTestNotificationInput: genericJsonObjectSchema(),
    PushTestNotificationResponse: genericJsonObjectSchema(),
    UpdateSharedWorkspaceInput: {
      additionalProperties: false,
      properties: {
        name: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      required: ['name'],
      type: 'object',
    },
    UpdateUserProfileInput: genericJsonObjectSchema(),
    UserProfile: genericJsonObjectSchema(),
    VoiceCommandResponse: {
      additionalProperties: false,
      properties: {
        intent: genericJsonObjectSchema(),
        stt: genericJsonObjectSchema(),
        transcript: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['intent', 'stt', 'transcript'],
      type: 'object',
    },
    VoiceMetricEvent: {
      additionalProperties: false,
      properties: {
        action_preview_duration_ms: {
          minimum: 0,
          type: 'number',
        },
        appRole: {
          enum: ['owner', 'test'],
          type: 'string',
        },
        audioBytes: {
          minimum: 0,
          type: 'integer',
        },
        audioDurationMs: {
          minimum: 0,
          type: 'integer',
        },
        confidenceBucket: {
          enum: ['low', 'medium', 'high'],
          type: 'string',
        },
        createdAt: {
          minLength: 1,
          type: 'string',
        },
        durationBucket: {
          enum: ['short', 'normal', 'long'],
          type: 'string',
        },
        errorCode: {
          maxLength: 160,
          minLength: 1,
          type: 'string',
        },
        eventName: {
          enum: [
            'voice_started',
            'wake_detected',
            'push_to_talk_started',
            'command_recording_started',
            'command_recording_cancelled',
            'local_validation_failed',
            'stt_upload_started',
            'stt_upload_completed',
            'stt_error',
            'transcript_received',
            'intent_parsed',
            'action_preview_created',
            'confirmation_shown',
            'confirmation_accepted',
            'confirmation_cancelled',
            'confirmation_edited',
            'clarification_requested',
            'action_executed',
            'action_failed',
            'undo_requested',
            'undo_success',
            'undo_failed',
            'voice_cue_listening_played',
            'voice_cue_done_played',
            'voice_cue_suppressed',
            'web_voice_unsupported',
            'web_voice_permission_denied',
            'web_voice_timeout',
            'llm_fallback_requested',
            'llm_fallback_used',
            'llm_fallback_rejected_schema',
            'llm_fallback_rejected_safety',
            'llm_fallback_latency_ms',
            'llm_fallback_provider_error',
            'llm_fallback_cost_estimated',
          ],
          type: 'string',
        },
        intentType: {
          enum: [
            'create_task',
            'add_shopping_item',
            'get_shopping_list',
            'reschedule_task',
            'get_agenda',
            'clarify',
            'unsupported',
          ],
          type: 'string',
        },
        llm_fallback_cost_estimated: {
          minimum: 0,
          type: 'number',
        },
        llm_fallback_latency_ms: {
          minimum: 0,
          type: 'number',
        },
        mic_click_to_confirmation_card_ms: {
          minimum: 0,
          type: 'number',
        },
        modelVersion: {
          maxLength: 160,
          minLength: 1,
          type: 'string',
        },
        parser_duration_ms: {
          minimum: 0,
          type: 'number',
        },
        platform: {
          enum: ['android', 'web', 'backend'],
          type: 'string',
        },
        previewStatus: {
          maxLength: 160,
          minLength: 1,
          type: 'string',
        },
        resultStatus: {
          maxLength: 160,
          minLength: 1,
          type: 'string',
        },
        source: {
          enum: [
            'android_wake_word',
            'android_push_to_talk',
            'web_push_to_talk',
            'backend_text',
          ],
          type: 'string',
        },
        sttProvider: {
          enum: ['yandex_speechkit', 'stub', 'local_stub'],
          type: 'string',
        },
        stt_upload_duration_ms: {
          minimum: 0,
          type: 'number',
        },
        time_to_confirmation_card_ms: {
          minimum: 0,
          type: 'number',
        },
        wake_detected_to_confirmation_card_ms: {
          minimum: 0,
          type: 'number',
        },
        wake_detected_to_recorder_start_ms: {
          minimum: 0,
          type: 'number',
        },
        wakeWordProvider: {
          enum: ['custom_onnx', 'custom_tflite', 'mock'],
          type: 'string',
        },
      },
      required: ['appRole', 'createdAt', 'eventName', 'platform', 'source'],
      type: 'object',
    },
    VoiceMetricResponse: {
      additionalProperties: false,
      properties: {
        ok: {
          type: 'boolean',
        },
      },
      required: ['ok'],
      type: 'object',
    },
    WeeklySphereStatsRecordResponse: genericJsonObjectSchema(),
    AuthRefreshInput: {
      additionalProperties: false,
      properties: {
        refreshToken: {
          description:
            'Optional for browser clients that use the HttpOnly refresh cookie.',
          minLength: 1,
          type: 'string',
        },
      },
      type: 'object',
    },
    AuthSignInInput: {
      additionalProperties: false,
      properties: {
        email: {
          format: 'email',
          type: 'string',
        },
        password: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['email', 'password'],
      type: 'object',
    },
    AuthSignUpInput: {
      additionalProperties: false,
      properties: {
        displayName: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
        email: {
          format: 'email',
          type: 'string',
        },
        password: {
          maxLength: 128,
          minLength: 6,
          type: 'string',
        },
      },
      required: ['email', 'password'],
      type: 'object',
    },
    AuthTokenResponse: {
      additionalProperties: false,
      properties: {
        accessToken: {
          minLength: 1,
          type: 'string',
        },
        expiresAt: {
          format: 'date-time',
          type: 'string',
        },
        refreshToken: {
          description:
            'Returned only for native clients that request body token transport.',
          minLength: 1,
          type: 'string',
        },
        user: {
          additionalProperties: false,
          properties: {
            email: {
              format: 'email',
              type: 'string',
            },
            id: {
              format: 'uuid',
              type: 'string',
            },
          },
          required: ['email', 'id'],
          type: 'object',
        },
      },
      required: ['accessToken', 'expiresAt', 'user'],
      type: 'object',
    },
    HealthResponse: {
      additionalProperties: false,
      properties: {
        appEnv: {
          type: 'string',
        },
        databaseStatus: {
          enum: ['disabled', 'down', 'up'],
          type: 'string',
        },
        status: {
          enum: ['ok'],
          type: 'string',
        },
        storageDriver: {
          enum: ['memory', 'postgres'],
          type: 'string',
        },
        timestamp: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: [
        'appEnv',
        'databaseStatus',
        'status',
        'storageDriver',
        'timestamp',
      ],
      type: 'object',
    },
    NewEmojiAssetInput: {
      additionalProperties: false,
      properties: {
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        kind: {
          $ref: '#/components/schemas/EmojiAssetKind',
        },
        keywords: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        label: {
          minLength: 1,
          type: 'string',
        },
        shortcode: {
          minLength: 1,
          type: 'string',
        },
        value: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['label', 'value'],
      type: 'object',
    },
    NewEmojiSetInput: {
      additionalProperties: false,
      properties: {
        description: {
          type: 'string',
        },
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        items: {
          items: {
            $ref: '#/components/schemas/NewEmojiAssetInput',
          },
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
        source: {
          $ref: '#/components/schemas/EmojiSetSource',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['description', 'items', 'title'],
      type: 'object',
    },
    AddEmojiSetItemsInput: {
      additionalProperties: false,
      properties: {
        items: {
          items: {
            $ref: '#/components/schemas/NewEmojiAssetInput',
          },
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
      },
      required: ['items'],
      type: 'object',
    },
    NewTaskInput: {
      additionalProperties: false,
      properties: {
        assigneeUserId: nullableStringSchema(),
        dueDate: nullableStringSchema(),
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        linkedTask: {
          nullable: true,
          properties: {
            id: {
              type: 'string',
            },
            workspaceId: {
              type: 'string',
            },
          },
          required: ['id', 'workspaceId'],
          type: 'object',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        remindBeforeStart: {
          type: 'boolean',
        },
        reminderOffsets: {
          items: {
            enum: [15, 30, 60],
            type: 'integer',
          },
          type: 'array',
        },
        reminderTimeZone: {
          type: 'string',
        },
        resource: {
          $ref: '#/components/schemas/TaskResource',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        sphereId: nullableStringSchema(),
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'assigneeUserId',
        'dueDate',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'requiresConfirmation',
        'title',
      ],
      type: 'object',
    },
    NewTaskTemplateInput: {
      additionalProperties: false,
      properties: {
        dueDate: nullableStringSchema(),
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'dueDate',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'title',
      ],
      type: 'object',
    },
    EmojiAssetKind: {
      enum: ['image'],
      type: 'string',
    },
    EmojiAssetRecord: {
      additionalProperties: false,
      properties: {
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        deletedAt: nullableStringSchema(),
        emojiSetId: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
        keywords: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        kind: {
          $ref: '#/components/schemas/EmojiAssetKind',
        },
        label: {
          minLength: 1,
          type: 'string',
        },
        shortcode: {
          minLength: 1,
          type: 'string',
        },
        sortOrder: {
          minimum: 0,
          type: 'integer',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
        value: {
          minLength: 1,
          type: 'string',
        },
        version: positiveIntegerSchema(),
        workspaceId: {
          type: 'string',
        },
      },
      required: [
        'createdAt',
        'deletedAt',
        'emojiSetId',
        'id',
        'keywords',
        'kind',
        'label',
        'shortcode',
        'sortOrder',
        'updatedAt',
        'value',
        'version',
        'workspaceId',
      ],
      type: 'object',
    },
    EmojiSetListResponse: {
      items: {
        $ref: '#/components/schemas/EmojiSetRecord',
      },
      type: 'array',
    },
    EmojiSetRecord: {
      additionalProperties: false,
      properties: {
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        deletedAt: nullableStringSchema(),
        description: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
        items: {
          items: {
            $ref: '#/components/schemas/EmojiAssetRecord',
          },
          type: 'array',
        },
        source: {
          $ref: '#/components/schemas/EmojiSetSource',
        },
        status: {
          enum: ['active', 'archived'],
          type: 'string',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
        version: positiveIntegerSchema(),
        workspaceId: {
          type: 'string',
        },
      },
      required: [
        'createdAt',
        'deletedAt',
        'description',
        'id',
        'items',
        'source',
        'status',
        'title',
        'updatedAt',
        'version',
        'workspaceId',
      ],
      type: 'object',
    },
    EmojiSetSource: {
      enum: ['custom'],
      type: 'string',
    },
    SessionActor: {
      additionalProperties: false,
      properties: {
        displayName: {
          type: 'string',
        },
        email: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
      },
      required: ['displayName', 'email', 'id'],
      type: 'object',
    },
    SessionResponse: {
      additionalProperties: false,
      properties: {
        actor: {
          $ref: '#/components/schemas/SessionActor',
        },
        actorUserId: {
          type: 'string',
        },
        appRole: {
          $ref: '#/components/schemas/AppRole',
        },
        groupRole: nullableRefSchema('WorkspaceGroupRole'),
        role: {
          $ref: '#/components/schemas/WorkspaceRole',
        },
        source: {
          enum: ['access_token', 'default', 'headers'],
          type: 'string',
        },
        userPreferences: {
          $ref: '#/components/schemas/UserPreferences',
        },
        workspace: {
          $ref: '#/components/schemas/SessionWorkspace',
        },
        workspaceId: {
          type: 'string',
        },
        workspaceSettings: {
          $ref: '#/components/schemas/WorkspaceSettings',
        },
        workspaces: {
          items: {
            $ref: '#/components/schemas/SessionWorkspaceMembership',
          },
          type: 'array',
        },
      },
      required: [
        'actor',
        'actorUserId',
        'appRole',
        'groupRole',
        'role',
        'source',
        'userPreferences',
        'workspace',
        'workspaceId',
        'workspaceSettings',
        'workspaces',
      ],
      type: 'object',
    },
    SessionWorkspace: {
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
        },
        kind: {
          $ref: '#/components/schemas/WorkspaceKind',
        },
        name: {
          type: 'string',
        },
        slug: {
          type: 'string',
        },
      },
      required: ['id', 'kind', 'name', 'slug'],
      type: 'object',
    },
    SessionWorkspaceMembership: {
      allOf: [
        {
          $ref: '#/components/schemas/SessionWorkspace',
        },
        {
          additionalProperties: false,
          properties: {
            groupRole: nullableRefSchema('WorkspaceGroupRole'),
            role: {
              $ref: '#/components/schemas/WorkspaceRole',
            },
          },
          required: ['groupRole', 'role'],
          type: 'object',
        },
      ],
    },
    WorkspaceGroupRole: {
      enum: ['group_admin', 'member', 'senior_member'],
      type: 'string',
    },
    WorkspaceKind: {
      enum: ['personal', 'shared'],
      type: 'string',
    },
    WorkspaceSettings: {
      additionalProperties: false,
      properties: {
        taskCompletionConfettiEnabled: {
          type: 'boolean',
        },
        wakeWordTrainingModeEnabled: {
          type: 'boolean',
        },
      },
      required: [
        'taskCompletionConfettiEnabled',
        'wakeWordTrainingModeEnabled',
      ],
      type: 'object',
    },
    CalendarViewMode: {
      enum: ['day', 'month', 'schedule', 'week'],
      type: 'string',
    },
    EnergyMode: {
      enum: ['maximum', 'minimum', 'normal'],
      type: 'string',
    },
    UserPreferences: {
      additionalProperties: false,
      properties: {
        calendarViewMode: {
          $ref: '#/components/schemas/CalendarViewMode',
        },
        energyMode: {
          $ref: '#/components/schemas/EnergyMode',
        },
        voiceAssistantEnabled: {
          type: 'boolean',
        },
      },
      required: ['calendarViewMode', 'energyMode', 'voiceAssistantEnabled'],
      type: 'object',
    },
    WorkspaceRole: {
      enum: ['admin', 'guest', 'owner', 'user'],
      type: 'string',
    },
    AppRole: {
      enum: ['admin', 'guest', 'owner', 'test', 'user'],
      type: 'string',
    },
    AssignableAppRole: {
      enum: ['admin', 'guest', 'test', 'user'],
      type: 'string',
    },
    AssignableWorkspaceGroupRole: {
      enum: ['group_admin', 'member', 'senior_member'],
      type: 'string',
    },
    CreateSharedWorkspaceInput: {
      additionalProperties: false,
      properties: {
        name: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      type: 'object',
    },
    AdminUserListResponse: {
      additionalProperties: false,
      properties: {
        users: {
          items: {
            $ref: '#/components/schemas/AdminUserRecord',
          },
          type: 'array',
        },
      },
      required: ['users'],
      type: 'object',
    },
    AdminUserRecord: {
      additionalProperties: false,
      properties: {
        appRole: {
          $ref: '#/components/schemas/AppRole',
        },
        displayName: {
          type: 'string',
        },
        email: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
        lastSeenAt: {
          format: 'date-time',
          nullable: true,
          type: 'string',
        },
        taskCount: {
          minimum: 0,
          type: 'integer',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: [
        'appRole',
        'displayName',
        'email',
        'id',
        'lastSeenAt',
        'taskCount',
        'updatedAt',
      ],
      type: 'object',
    },
    AdminUserRoleUpdateInput: {
      additionalProperties: false,
      properties: {
        role: {
          $ref: '#/components/schemas/AssignableAppRole',
        },
      },
      required: ['role'],
      type: 'object',
    },
    WorkspaceSettingsUpdateInput: {
      additionalProperties: false,
      properties: {
        taskCompletionConfettiEnabled: {
          type: 'boolean',
        },
        wakeWordTrainingModeEnabled: {
          type: 'boolean',
        },
      },
      required: [
        'taskCompletionConfettiEnabled',
        'wakeWordTrainingModeEnabled',
      ],
      type: 'object',
    },
    UserPreferencesUpdateInput: {
      additionalProperties: false,
      properties: {
        calendarViewMode: {
          $ref: '#/components/schemas/CalendarViewMode',
        },
        energyMode: {
          $ref: '#/components/schemas/EnergyMode',
        },
        voiceAssistantEnabled: {
          type: 'boolean',
        },
      },
      type: 'object',
    },
    WorkspaceUserListResponse: {
      additionalProperties: false,
      properties: {
        users: {
          items: {
            $ref: '#/components/schemas/WorkspaceUserRecord',
          },
          type: 'array',
        },
      },
      required: ['users'],
      type: 'object',
    },
    WorkspaceUserRecord: {
      additionalProperties: false,
      properties: {
        displayName: {
          type: 'string',
        },
        email: {
          type: 'string',
        },
        groupRole: nullableRefSchema('WorkspaceGroupRole'),
        id: {
          type: 'string',
        },
        isOwner: {
          type: 'boolean',
        },
        joinedAt: {
          format: 'date-time',
          type: 'string',
        },
        membershipId: {
          type: 'string',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: [
        'displayName',
        'email',
        'groupRole',
        'id',
        'isOwner',
        'joinedAt',
        'membershipId',
        'updatedAt',
      ],
      type: 'object',
    },
    WorkspaceUserGroupRoleUpdateInput: {
      additionalProperties: false,
      properties: {
        groupRole: {
          $ref: '#/components/schemas/AssignableWorkspaceGroupRole',
        },
      },
      required: ['groupRole'],
      type: 'object',
    },
    WorkspaceInvitationListResponse: {
      additionalProperties: false,
      properties: {
        invitations: {
          items: {
            $ref: '#/components/schemas/WorkspaceInvitationRecord',
          },
          type: 'array',
        },
      },
      required: ['invitations'],
      type: 'object',
    },
    WorkspaceInvitationStatus: {
      enum: ['accepted', 'declined', 'pending'],
      type: 'string',
    },
    WorkspaceInvitationRecord: {
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
        },
        groupRole: {
          $ref: '#/components/schemas/AssignableWorkspaceGroupRole',
        },
        id: {
          type: 'string',
        },
        invitedAt: {
          format: 'date-time',
          type: 'string',
        },
        status: {
          $ref: '#/components/schemas/WorkspaceInvitationStatus',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: [
        'email',
        'groupRole',
        'id',
        'invitedAt',
        'status',
        'updatedAt',
      ],
      type: 'object',
    },
    ReceivedWorkspaceInvitationListResponse: {
      additionalProperties: false,
      properties: {
        invitations: {
          items: {
            $ref: '#/components/schemas/ReceivedWorkspaceInvitationRecord',
          },
          type: 'array',
        },
      },
      required: ['invitations'],
      type: 'object',
    },
    ReceivedWorkspaceInvitationRecord: {
      additionalProperties: false,
      properties: {
        groupRole: {
          $ref: '#/components/schemas/AssignableWorkspaceGroupRole',
        },
        id: {
          type: 'string',
        },
        invitedAt: {
          format: 'date-time',
          type: 'string',
        },
        status: {
          enum: ['pending'],
          type: 'string',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
        workspace: {
          $ref: '#/components/schemas/SessionWorkspace',
        },
      },
      required: [
        'groupRole',
        'id',
        'invitedAt',
        'status',
        'updatedAt',
        'workspace',
      ],
      type: 'object',
    },
    WorkspaceInvitationCreateInput: {
      additionalProperties: false,
      properties: {
        email: {
          format: 'email',
          maxLength: 320,
          type: 'string',
        },
        groupRole: {
          $ref: '#/components/schemas/AssignableWorkspaceGroupRole',
        },
      },
      required: ['email'],
      type: 'object',
    },
    TaskListResponse: {
      items: {
        $ref: '#/components/schemas/TaskRecord',
      },
      type: 'array',
    },
    TaskListPageResponse: {
      additionalProperties: false,
      properties: {
        hasMore: {
          type: 'boolean',
        },
        items: {
          items: {
            $ref: '#/components/schemas/TaskRecord',
          },
          type: 'array',
        },
        limit: {
          maximum: 100,
          minimum: 1,
          type: 'integer',
        },
        nextOffset: {
          minimum: 0,
          nullable: true,
          type: 'integer',
        },
        offset: {
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['hasMore', 'items', 'limit', 'nextOffset', 'offset'],
      type: 'object',
    },
    TaskTemplateListResponse: {
      items: {
        $ref: '#/components/schemas/TaskTemplateRecord',
      },
      type: 'array',
    },
    TaskEventListResponse: {
      additionalProperties: false,
      properties: {
        events: {
          items: {
            $ref: '#/components/schemas/TaskEventRecord',
          },
          type: 'array',
        },
        nextEventId: {
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['events', 'nextEventId'],
      type: 'object',
    },
    TaskEventRecord: {
      additionalProperties: false,
      properties: {
        actorUserId: nullableStringSchema(),
        eventId: {
          type: 'string',
        },
        eventType: {
          type: 'string',
        },
        id: {
          minimum: 0,
          type: 'integer',
        },
        occurredAt: {
          format: 'date-time',
          type: 'string',
        },
        payload: {
          additionalProperties: true,
          type: 'object',
        },
        taskId: nullableStringSchema(),
        workspaceId: {
          type: 'string',
        },
      },
      required: [
        'actorUserId',
        'eventId',
        'eventType',
        'id',
        'occurredAt',
        'payload',
        'taskId',
        'workspaceId',
      ],
      type: 'object',
    },
    TaskRecord: {
      allOf: [
        {
          $ref: '#/components/schemas/Task',
        },
        {
          additionalProperties: false,
          properties: {
            deletedAt: nullableStringSchema(),
            updatedAt: {
              format: 'date-time',
              type: 'string',
            },
            version: positiveIntegerSchema(),
            workspaceId: {
              type: 'string',
            },
          },
          required: ['deletedAt', 'updatedAt', 'version', 'workspaceId'],
          type: 'object',
        },
      ],
    },
    TaskTemplateRecord: {
      allOf: [
        {
          $ref: '#/components/schemas/TaskTemplate',
        },
        {
          additionalProperties: false,
          properties: {
            deletedAt: nullableStringSchema(),
            updatedAt: {
              format: 'date-time',
              type: 'string',
            },
            version: positiveIntegerSchema(),
            workspaceId: {
              type: 'string',
            },
          },
          required: ['deletedAt', 'updatedAt', 'version', 'workspaceId'],
          type: 'object',
        },
      ],
    },
    TaskTemplate: {
      additionalProperties: false,
      properties: {
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        dueDate: nullableStringSchema(),
        id: {
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'createdAt',
        'dueDate',
        'id',
        'icon',
        'importance',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'title',
        'urgency',
      ],
      type: 'object',
    },
    Task: {
      additionalProperties: false,
      properties: {
        assigneeDisplayName: nullableStringSchema(),
        assigneeUserId: nullableStringSchema(),
        authorDisplayName: nullableStringSchema(),
        authorUserId: nullableStringSchema(),
        completedAt: nullableStringSchema(),
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        dueDate: nullableStringSchema(),
        id: {
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        remindBeforeStart: {
          type: 'boolean',
        },
        reminderOffsets: {
          items: {
            enum: [15, 30, 60],
            type: 'integer',
          },
          type: 'array',
        },
        resource: {
          $ref: '#/components/schemas/TaskResource',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        sphereId: nullableStringSchema(),
        sourceWorkspace: {
          nullable: true,
          properties: {
            id: {
              type: 'string',
            },
            name: {
              type: 'string',
            },
          },
          required: ['id', 'name'],
          type: 'object',
        },
        status: {
          $ref: '#/components/schemas/TaskStatus',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'assigneeDisplayName',
        'assigneeUserId',
        'authorDisplayName',
        'authorUserId',
        'completedAt',
        'createdAt',
        'dueDate',
        'id',
        'icon',
        'importance',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'resource',
        'requiresConfirmation',
        'sphereId',
        'status',
        'title',
        'urgency',
      ],
      type: 'object',
    },
    TaskImportance: {
      enum: ['important', 'not_important'],
      type: 'string',
    },
    TaskResource: {
      maximum: 5,
      minimum: -5,
      nullable: true,
      type: 'integer',
    },
    TaskDetailsUpdateInput: {
      allOf: [
        {
          $ref: '#/components/schemas/NewTaskInput',
        },
        {
          additionalProperties: false,
          properties: {
            expectedVersion: positiveIntegerSchema(),
          },
          type: 'object',
        },
      ],
    },
    TaskScheduleInput: {
      additionalProperties: false,
      properties: {
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
      },
      required: ['plannedDate', 'plannedEndTime', 'plannedStartTime'],
      type: 'object',
    },
    TaskPersonalTransferInput: {
      additionalProperties: false,
      properties: {
        expectedVersion: positiveIntegerSchema(),
      },
      type: 'object',
    },
    TaskScheduleUpdateInput: {
      additionalProperties: false,
      properties: {
        expectedVersion: positiveIntegerSchema(),
        schedule: {
          $ref: '#/components/schemas/TaskScheduleInput',
        },
      },
      required: ['schedule'],
      type: 'object',
    },
    TaskStatus: {
      enum: ['done', 'in_progress', 'ready_for_review', 'todo'],
      type: 'string',
    },
    TaskStatusUpdateInput: {
      additionalProperties: false,
      properties: {
        expectedVersion: positiveIntegerSchema(),
        status: {
          $ref: '#/components/schemas/TaskStatus',
        },
      },
      required: ['status'],
      type: 'object',
    },
    TaskUrgency: {
      enum: ['not_urgent', 'urgent'],
      type: 'string',
    },
  }
}
