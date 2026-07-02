import type { ColumnType, Generated } from 'kysely'

export type JsonObject = Record<string, unknown>
export type DateColumn = ColumnType<string, string, string>
export type TimeColumn = ColumnType<string, string, string>
export type TimestampColumn = ColumnType<string, string | Date, string | Date>
export type AppTaskTimeKind =
  'date_only' | 'fixed_zone_datetime' | 'floating_local_time' | 'instant'
export type AppTaskStageType = 'parallel' | 'task' | 'template' | 'waiting'
export type AppTaskCompletionType = 'advanced' | 'completed'
export type AppTaskChainStatus = 'active' | 'archived' | 'completed'

export interface AppTasksTable {
  assignee_user_id: string | null
  chain_id: string | null
  completion_type: AppTaskCompletionType | null
  completed_at: TimestampColumn | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  due_at: TimestampColumn | null
  due_on: DateColumn | null
  id: Generated<string>
  local_date: DateColumn | null
  local_time: TimeColumn | null
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  parent_task_id: string | null
  planned_on: DateColumn | null
  previous_task_id: string | null
  priority: number
  project_id: string | null
  recurrence_rule: string | null
  recurrence_start_date: DateColumn | null
  recurrence_time_zone: string | null
  resource: number | null
  sphere_id: string | null
  sort_key: string
  starts_at_utc: TimestampColumn | null
  stage_index: number | null
  stage_type: AppTaskStageType | null
  status: 'todo' | 'in_progress' | 'ready_for_review' | 'done' | 'archived'
  time_kind: Generated<AppTaskTimeKind>
  time_zone: string | null
  time_zone_inferred: Generated<boolean>
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskChainsTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  root_task_id: string | null
  status: Generated<AppTaskChainStatus>
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppChaosInboxItemsTable {
  activated_at: TimestampColumn | null
  completed_at: TimestampColumn | null
  converted_note_id: string | null
  converted_task_id: string | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  due_on: DateColumn | null
  id: Generated<string>
  is_favorite: boolean
  kind: 'unknown' | 'task' | 'note' | 'shopping' | 'event' | 'idea'
  priority: 'low' | 'medium' | 'high' | null
  shopping_category: 'groceries' | 'household' | 'other' | null
  source: 'manual' | 'quick_add' | 'widget' | 'voice'
  sphere_id: string | null
  status: 'new' | 'in_review' | 'converted' | 'archived'
  text: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppDailyPlansTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  date: DateColumn
  deleted_at: TimestampColumn | null
  energy_mode: 'minimum' | 'normal' | 'maximum'
  focus_task_ids: ColumnType<string[], string[] | string, string[] | string>
  id: Generated<string>
  overload_score: number
  routine_task_ids: ColumnType<string[], string[] | string, string[] | string>
  support_task_ids: ColumnType<string[], string[] | string, string[] | string>
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppHabitsTable {
  color: string
  created_at: Generated<TimestampColumn>
  created_by: string | null
  days_of_week: ColumnType<number[], number[] | string, number[] | string>
  deleted_at: TimestampColumn | null
  description: string
  end_date: DateColumn | null
  frequency: 'daily' | 'weekly' | 'custom'
  icon: string
  id: Generated<string>
  is_active: boolean
  reminder_time: TimeColumn | null
  sort_order: number
  sphere_id: string | null
  start_date: DateColumn
  target_type: 'check' | 'count' | 'duration'
  target_value: number
  title: string
  unit: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppHabitEntriesTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  date: DateColumn
  deleted_at: TimestampColumn | null
  habit_id: string
  id: Generated<string>
  note: string
  status: 'done' | 'skipped'
  target_value: number
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  value: number
  version: Generated<number>
  workspace_id: string
}

export interface AppSelfCareItemsTable {
  category:
    | 'beauty'
    | 'body'
    | 'custom'
    | 'daily_base'
    | 'emotional'
    | 'health'
    | 'medical'
    | 'movement'
    | 'nutrition'
    | 'relax'
    | 'sleep'
  color: string | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  created_from_template_id: string | null
  custom_category_id: string | null
  default_duration_minutes: number | null
  deleted_at: TimestampColumn | null
  description: string
  icon: string | null
  id: Generated<string>
  importance: 'gentle' | 'recommended' | 'required'
  is_active: boolean
  is_archived: boolean
  is_private: boolean
  migrated_from_habit_id: string | null
  minimum_version_description: string | null
  minimum_version_duration_minutes: number | null
  minimum_version_title: string | null
  preferred_time_of_day:
    'afternoon' | 'anytime' | 'evening' | 'morning' | 'night' | null
  title: string
  type:
    | 'appointment'
    | 'course'
    | 'flexible_goal'
    | 'habit'
    | 'exercise'
    | 'measurement'
    | 'medical'
    | 'mood_check'
    | 'procedure'
    | 'rest_action'
    | 'ritual'
    | 'task'
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppSelfCareItemAlternativesTable {
  counts_as_completion: boolean
  description: string
  id: Generated<string>
  item_id: string
  title: string
}

export interface AppSelfCareScheduleRulesTable {
  allow_multiple_per_day: boolean
  created_at: Generated<TimestampColumn>
  day_of_month: number | null
  days_of_week: ColumnType<number[], number[] | string, number[] | string>
  end_date: DateColumn | null
  flexible_period: 'day' | 'month' | 'week' | null
  flexible_target_count: number | null
  generate_in_calendar: boolean
  generate_in_task_list: boolean
  id: Generated<string>
  interval_unit: 'day' | 'month' | 'week' | 'year' | null
  interval_value: number | null
  item_id: string
  month_of_year: number | null
  preferred_time: TimeColumn | null
  reminder_offsets_minutes: ColumnType<
    number[],
    number[] | string,
    number[] | string
  >
  repeat_kind:
    | 'after_completion'
    | 'course'
    | 'daily'
    | 'flexible_goal'
    | 'interval'
    | 'monthly'
    | 'none'
    | 'weekly'
    | 'yearly'
  start_date: DateColumn | null
  timezone: string | null
  updated_at: Generated<TimestampColumn>
  week_of_month: number | null
}

export interface AppSelfCareOccurrencesTable {
  completed_at: TimestampColumn | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  due_at: TimestampColumn | null
  generated_at: TimestampColumn | null
  id: Generated<string>
  item_id: string
  moved_to: DateColumn | null
  reminder_offsets_minutes: ColumnType<
    number[],
    number[] | string,
    number[] | string
  >
  reminder_time_zone: string | null
  scheduled_for: DateColumn
  schedule_rule_id: string | null
  status:
    | 'cancelled'
    | 'done'
    | 'missed'
    | 'moved'
    | 'partial'
    | 'scheduled'
    | 'skipped'
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
}

export interface AppSelfCareRemindersTable {
  canceled_at: TimestampColumn | null
  claimed_at: TimestampColumn | null
  created_at: Generated<TimestampColumn>
  due_at: TimestampColumn
  id: Generated<string>
  item_id: string
  occurrence_id: string
  reminder_at: TimestampColumn
  remind_offset_minutes: number
  schedule_rule_id: string | null
  sent_at: TimestampColumn | null
  time_zone: string
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppSelfCareCompletionsTable {
  alternative_title: string | null
  completed_at: TimestampColumn
  completed_variant: 'alternative' | 'full' | 'minimum' | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  duration_minutes: number | null
  energy_after: number | null
  energy_before: number | null
  exercise_sets: ColumnType<
    Array<{ index: number; value: number }>,
    Array<{ index: number; value: number }> | string,
    Array<{ index: number; value: number }> | string
  >
  id: Generated<string>
  item_id: string
  measurement_unit: string | null
  measurement_value: ColumnType<
    number | null,
    number | string | null,
    number | string | null
  >
  mood_after: number | null
  mood_before: number | null
  note: string
  occurrence_id: string | null
  scheduled_for: DateColumn | null
  status:
    'alternative_done' | 'cancelled' | 'done' | 'moved' | 'partial' | 'skipped'
  user_id: string
}

export interface AppSelfCareRitualStepsTable {
  created_at: Generated<TimestampColumn>
  default_checked: boolean
  id: Generated<string>
  is_optional: boolean
  item_id: string
  sort_order: number
  title: string
  updated_at: Generated<TimestampColumn>
}

export interface AppSelfCareRitualStepCompletionsTable {
  completion_id: string
  id: Generated<string>
  is_done: boolean
  step_id: string
}

export interface AppSelfCareRitualStepDraftsTable {
  created_at: Generated<TimestampColumn>
  date: DateColumn
  id: Generated<string>
  item_id: string
  occurrence_id: string | null
  step_ids: ColumnType<string[], string[] | string, string[] | string>
  updated_at: Generated<TimestampColumn>
  user_id: string
  workspace_id: string
}

export interface AppSelfCareProcedureDetailsTable {
  contact: string | null
  created_at: Generated<TimestampColumn>
  currency: string | null
  default_price: ColumnType<
    number | null,
    number | string | null,
    number | string | null
  >
  id: Generated<string>
  item_id: string
  place: string | null
  specialist_name: string | null
  updated_at: Generated<TimestampColumn>
}

export interface AppSelfCareAppointmentDetailsTable {
  created_at: Generated<TimestampColumn>
  currency: string | null
  ends_at: TimestampColumn | null
  id: Generated<string>
  item_id: string
  occurrence_id: string | null
  place: string | null
  preparation_note: string | null
  price: ColumnType<
    number | null,
    number | string | null,
    number | string | null
  >
  result_note: string | null
  specialist_contact: string | null
  specialist_name: string | null
  starts_at: TimestampColumn
  updated_at: Generated<TimestampColumn>
}

export interface AppSelfCareMedicalDetailsTable {
  analysis_list: ColumnType<string[], string[] | string, string[] | string>
  clinic_address: string | null
  clinic_name: string | null
  created_at: Generated<TimestampColumn>
  document_urls: ColumnType<string[], string[] | string, string[] | string>
  doctor_name: string | null
  id: Generated<string>
  item_id: string
  next_control_date: DateColumn | null
  phone: string | null
  reminder_strategy: 'normal' | 'persistent' | 'soft'
  result_note: string | null
  updated_at: Generated<TimestampColumn>
  website: string | null
}

export interface AppSelfCareCourseDetailsTable {
  break_days: number
  completed_count: number
  course_type: 'days' | 'sessions'
  created_at: Generated<TimestampColumn>
  end_date: DateColumn | null
  id: Generated<string>
  is_completed: boolean
  is_paused: boolean
  item_id: string
  repeat_after_completion: boolean
  start_date: DateColumn | null
  total_count: number
  updated_at: Generated<TimestampColumn>
}

export interface AppSelfCareMeasurementDetailsTable {
  created_at: Generated<TimestampColumn>
  id: Generated<string>
  item_id: string
  target_max: ColumnType<
    number | null,
    number | string | null,
    number | string | null
  >
  target_min: ColumnType<
    number | null,
    number | string | null,
    number | string | null
  >
  unit: string
  updated_at: Generated<TimestampColumn>
  value_label: string
}

export interface AppSelfCareExerciseDetailsTable {
  created_at: Generated<TimestampColumn>
  id: Generated<string>
  item_id: string
  metric_type: 'count' | 'distance' | 'time' | 'weight'
  planned_sets: number | null
  planned_value: ColumnType<
    number | null,
    number | string | null,
    number | string | null
  >
  unit: 'kg' | 'km' | 'm' | 'min' | 'reps'
  updated_at: Generated<TimestampColumn>
  use_sets: boolean
}

export interface AppSelfCareDailyStatesTable {
  created_at: Generated<TimestampColumn>
  date: DateColumn
  energy: number | null
  id: Generated<string>
  mood: number | null
  note: string
  pain: number | null
  sleep_quality: number | null
  stress: number | null
  updated_at: Generated<TimestampColumn>
  user_id: string
}

export interface AppSelfCareTemplatesTable {
  category: AppSelfCareItemsTable['category']
  color: string | null
  created_at: Generated<TimestampColumn>
  default_schedule: ColumnType<
    JsonObject | null,
    JsonObject | string | null,
    JsonObject | string | null
  >
  default_steps: ColumnType<string[], string[] | string, string[] | string>
  description: string
  icon: string | null
  id: string
  importance: AppSelfCareItemsTable['importance']
  is_system: boolean
  title: string
  type: AppSelfCareItemsTable['type']
  updated_at: Generated<TimestampColumn>
}

export interface AppSelfCareSettingsTable {
  created_at: Generated<TimestampColumn>
  currency: string | null
  default_reminder_tone: 'normal' | 'soft'
  gentle_mode_date: DateColumn | null
  gentle_mode_enabled_today: boolean
  id: Generated<string>
  quiet_hours_end: TimeColumn | null
  quiet_hours_start: TimeColumn | null
  show_appointments_in_calendar: boolean
  show_daily_rituals_in_calendar: boolean
  show_self_care_in_main_tasks: boolean
  updated_at: Generated<TimestampColumn>
  user_id: string
}

export interface AppSelfCareMinimumItemsTable {
  created_at: Generated<TimestampColumn>
  id: Generated<string>
  is_active: boolean
  linked_item_id: string | null
  sort_order: number
  title: string
  updated_at: Generated<TimestampColumn>
  user_id: string
}

export interface AppCleaningZonesTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  day_of_week: number
  deleted_at: TimestampColumn | null
  description: string
  id: Generated<string>
  is_active: boolean
  sort_order: number
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppCleaningTasksTable {
  assignee: 'self' | 'partner' | 'child' | 'anyone'
  created_at: Generated<TimestampColumn>
  created_by: string | null
  custom_interval_days: number | null
  deleted_at: TimestampColumn | null
  depth: 'minimum' | 'regular' | 'deep'
  description: string
  energy: 'low' | 'normal' | 'high'
  estimated_minutes: number | null
  frequency_interval: number
  frequency_type: 'weekly' | 'monthly' | 'custom'
  id: Generated<string>
  impact_score: number
  is_active: boolean
  is_seasonal: boolean
  priority: 'low' | 'normal' | 'high'
  season_months: ColumnType<number[], number[] | string, number[] | string>
  sort_order: number
  scope: 'zone' | 'general'
  tags: ColumnType<string[], string[] | string, string[] | string>
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
  zone_id: string | null
}

export interface AppCleaningTaskStatesTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  last_completed_at: TimestampColumn | null
  last_postponed_at: TimestampColumn | null
  last_skipped_at: TimestampColumn | null
  next_due_at: DateColumn | null
  postpone_count: number
  task_id: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppCleaningTaskHistoryTable {
  action: 'completed' | 'postponed' | 'skipped'
  created_at: Generated<TimestampColumn>
  created_by: string | null
  date: DateColumn
  id: Generated<string>
  note: string
  target_date: DateColumn | null
  task_id: string
  user_id: string
  workspace_id: string
  zone_id: string | null
}

export interface AppLifeSpheresTable {
  color: string | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  icon: string | null
  id: Generated<string>
  is_active: boolean
  is_default: boolean
  name: string
  sort_order: number
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskTemplatesTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  due_on: DateColumn | null
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  planned_end_time: TimeColumn | null
  planned_on: DateColumn | null
  planned_start_time: TimeColumn | null
  project_id: string | null
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppUsersTable {
  app_role: 'owner' | 'admin' | 'test' | 'user' | 'guest'
  avatar_url: string | null
  calendar_view_mode: Generated<'day' | 'week' | 'month' | 'schedule'>
  created_at: Generated<TimestampColumn>
  default_time_zone: string | null
  deleted_at: TimestampColumn | null
  display_name: string
  email: string
  energy_mode: Generated<'minimum' | 'normal' | 'maximum'>
  id: Generated<string>
  last_seen_time_zone: string | null
  locale: string
  time_zone_mode: Generated<'device' | 'manual' | 'workspace'>
  timezone: string
  updated_at: Generated<TimestampColumn>
  version: Generated<number>
  voice_assistant_enabled: Generated<boolean>
}

export interface AppAuthCredentialsTable {
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  email: string
  password_hash: string
  password_updated_at: Generated<TimestampColumn>
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
}

export interface AppAuthRefreshTokensTable {
  created_at: Generated<TimestampColumn>
  device_id: string | null
  expires_at: TimestampColumn
  id: Generated<string>
  ip_address: string | null
  last_used_at: TimestampColumn | null
  replaced_by_token_id: string | null
  revoked_at: TimestampColumn | null
  rotated_at: TimestampColumn | null
  session_id: string
  token_hash: string
  user_agent: string | null
  user_id: string
}

export interface AppAuthPasswordResetTokensTable {
  created_at: Generated<TimestampColumn>
  expires_at: TimestampColumn
  id: Generated<string>
  ip_address: string | null
  token_hash: string
  used_at: TimestampColumn | null
  user_agent: string | null
  user_id: string
}

export interface AppMcpOAuthTokensTable {
  access_token_hash: string
  client_id: string | null
  created_at: Generated<TimestampColumn>
  expires_at: TimestampColumn
  id: Generated<string>
  issuer: string
  last_used_at: TimestampColumn | null
  refresh_token_hash: string | null
  resource: string
  revoked_at: TimestampColumn | null
  scopes: ColumnType<string[], string[] | string, string[] | string>
  user_id: string
}

export interface AppMcpAuditLogsTable {
  created_at: Generated<TimestampColumn>
  id: Generated<string>
  input: ColumnType<
    JsonObject | null,
    JsonObject | string | null,
    JsonObject | string | null
  >
  ip_hash: string | null
  output_summary: ColumnType<
    JsonObject | null,
    JsonObject | string | null,
    JsonObject | string | null
  >
  token_id: string | null
  tool_name: string
  user_agent: string | null
  user_id: string | null
}

export interface AppOAuthAuthorizationCodesTable {
  client_id: string
  code_hash: string
  consumed_at: TimestampColumn | null
  created_at: Generated<TimestampColumn>
  expires_at: TimestampColumn
  id: Generated<string>
  ip_address: string | null
  redirect_uri: string
  scope: string
  user_agent: string | null
  user_id: string
}

export interface AppWorkspacesTable {
  created_at: Generated<TimestampColumn>
  default_time_zone: string | null
  deleted_at: TimestampColumn | null
  description: string
  id: Generated<string>
  kind: 'personal' | 'shared'
  name: string
  owner_user_id: string
  slug: string
  task_completion_confetti_enabled: boolean
  wake_word_training_mode_enabled: Generated<boolean>
  updated_at: Generated<TimestampColumn>
  version: Generated<number>
}

export interface AppWorkspaceMembersTable {
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  group_role: 'group_admin' | 'senior_member' | 'member' | null
  id: Generated<string>
  invited_by: string | null
  joined_at: Generated<TimestampColumn>
  role: 'owner' | 'admin' | 'user' | 'guest'
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppWorkspaceInvitationsTable {
  accepted_at: TimestampColumn | null
  accepted_by: string | null
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  declined_at: TimestampColumn | null
  declined_by: string | null
  email: string
  group_role: 'group_admin' | 'senior_member' | 'member'
  id: Generated<string>
  invited_by: string | null
  updated_at: Generated<TimestampColumn>
  version: Generated<number>
  workspace_id: string
}

export interface AppProjectsTable {
  color: string | null
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  icon: string
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  position: number
  slug: string
  status: 'active' | 'archived'
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppEmojiSetsTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  description: string
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  slug: string
  source: 'custom'
  status: 'active' | 'archived'
  title: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppEmojiAssetsTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  emoji_set_id: string
  id: Generated<string>
  keywords: ColumnType<string[], string[] | string, string[] | string>
  kind: 'image'
  label: string
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  shortcode: string
  sort_order: number
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  value: string
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskTimeBlocksTable {
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  ends_at: TimestampColumn
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  position: number
  source: string
  starts_at: TimestampColumn
  task_id: string
  timezone: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskEventsTable {
  actor_user_id: string | null
  event_id: Generated<string>
  event_type: string
  id: Generated<number>
  occurred_at: Generated<TimestampColumn>
  payload: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  task_id: string | null
  workspace_id: string
}

export interface AppTaskRemindersTable {
  canceled_at: TimestampColumn | null
  claimed_at: TimestampColumn | null
  created_at: Generated<TimestampColumn>
  id: Generated<string>
  planned_date: DateColumn
  planned_start_time: TimeColumn
  remind_offset_minutes: number
  sent_at: TimestampColumn | null
  task_id: string
  time_zone: string
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppTaskOccurrencesTable {
  created_at: Generated<TimestampColumn>
  id: Generated<string>
  local_time: TimeColumn | null
  occurrence_date: DateColumn
  starts_at_utc: TimestampColumn | null
  status: Generated<string>
  task_id: string
  time_zone: string | null
  updated_at: Generated<TimestampColumn>
}

export interface AppTaskAttachmentsTable {
  content_type: string
  created_at: Generated<TimestampColumn>
  created_by: string | null
  deleted_at: TimestampColumn | null
  id: Generated<string>
  metadata: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  original_filename: string
  size_bytes: number
  storage_bucket: string
  storage_object_path: string
  task_id: string
  updated_at: Generated<TimestampColumn>
  updated_by: string | null
  version: Generated<number>
  workspace_id: string
}

export interface AppDeviceSessionsTable {
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  device_fingerprint: string
  id: Generated<string>
  last_seen_at: Generated<TimestampColumn>
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppPushDevicesTable {
  app_version: string | null
  created_at: Generated<TimestampColumn>
  deleted_at: TimestampColumn | null
  device_name: string | null
  id: Generated<string>
  installation_id: string
  last_registered_at: TimestampColumn
  locale: string | null
  platform: 'android'
  token: string
  updated_at: Generated<TimestampColumn>
  user_id: string
  version: Generated<number>
  workspace_id: string
}

export interface AppOutboxTable {
  aggregate_id: string
  aggregate_type: string
  attempts: Generated<number>
  available_at: Generated<TimestampColumn>
  created_at: Generated<TimestampColumn>
  id: Generated<number>
  last_error: string | null
  locked_at: TimestampColumn | null
  payload: ColumnType<JsonObject, JsonObject | string, JsonObject | string>
  processed_at: TimestampColumn | null
  status: Generated<'pending' | 'processing' | 'completed' | 'failed'>
  topic: string
}

export interface DatabaseSchema {
  'app.auth_credentials': AppAuthCredentialsTable
  'app.auth_password_reset_tokens': AppAuthPasswordResetTokensTable
  'app.auth_refresh_tokens': AppAuthRefreshTokensTable
  'app.chaos_inbox_items': AppChaosInboxItemsTable
  'app.cleaning_task_history': AppCleaningTaskHistoryTable
  'app.cleaning_task_states': AppCleaningTaskStatesTable
  'app.cleaning_tasks': AppCleaningTasksTable
  'app.cleaning_zones': AppCleaningZonesTable
  'app.device_sessions': AppDeviceSessionsTable
  'app.daily_plans': AppDailyPlansTable
  'app.emoji_assets': AppEmojiAssetsTable
  'app.emoji_sets': AppEmojiSetsTable
  'app.habit_entries': AppHabitEntriesTable
  'app.habits': AppHabitsTable
  'app.life_spheres': AppLifeSpheresTable
  'app.mcp_audit_logs': AppMcpAuditLogsTable
  'app.mcp_oauth_tokens': AppMcpOAuthTokensTable
  'app.outbox': AppOutboxTable
  'app.oauth_authorization_codes': AppOAuthAuthorizationCodesTable
  'app.push_devices': AppPushDevicesTable
  'app.projects': AppProjectsTable
  'app.self_care_appointment_details': AppSelfCareAppointmentDetailsTable
  'app.self_care_completions': AppSelfCareCompletionsTable
  'app.self_care_course_details': AppSelfCareCourseDetailsTable
  'app.self_care_daily_states': AppSelfCareDailyStatesTable
  'app.self_care_exercise_details': AppSelfCareExerciseDetailsTable
  'app.self_care_item_alternatives': AppSelfCareItemAlternativesTable
  'app.self_care_items': AppSelfCareItemsTable
  'app.self_care_medical_details': AppSelfCareMedicalDetailsTable
  'app.self_care_measurement_details': AppSelfCareMeasurementDetailsTable
  'app.self_care_minimum_items': AppSelfCareMinimumItemsTable
  'app.self_care_occurrences': AppSelfCareOccurrencesTable
  'app.self_care_procedure_details': AppSelfCareProcedureDetailsTable
  'app.self_care_reminders': AppSelfCareRemindersTable
  'app.self_care_ritual_step_completions': AppSelfCareRitualStepCompletionsTable
  'app.self_care_ritual_step_drafts': AppSelfCareRitualStepDraftsTable
  'app.self_care_ritual_steps': AppSelfCareRitualStepsTable
  'app.self_care_schedule_rules': AppSelfCareScheduleRulesTable
  'app.self_care_settings': AppSelfCareSettingsTable
  'app.self_care_templates': AppSelfCareTemplatesTable
  'app.task_attachments': AppTaskAttachmentsTable
  'app.task_chains': AppTaskChainsTable
  'app.task_events': AppTaskEventsTable
  'app.task_occurrences': AppTaskOccurrencesTable
  'app.task_reminders': AppTaskRemindersTable
  'app.task_templates': AppTaskTemplatesTable
  'app.task_time_blocks': AppTaskTimeBlocksTable
  'app.tasks': AppTasksTable
  'app.users': AppUsersTable
  'app.workspace_invitations': AppWorkspaceInvitationsTable
  'app.workspace_members': AppWorkspaceMembersTable
  'app.workspaces': AppWorkspacesTable
}
