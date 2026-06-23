-- noinspection SqlNoDataSourceInspection

grant update (
  calendar_view_mode,
  default_time_zone,
  energy_mode,
  last_seen_time_zone,
  time_zone_mode,
  voice_assistant_enabled
) on table app.users to authenticated;

grant update (
  default_time_zone,
  task_completion_confetti_enabled,
  wake_word_training_mode_enabled
) on table app.workspaces to authenticated;
