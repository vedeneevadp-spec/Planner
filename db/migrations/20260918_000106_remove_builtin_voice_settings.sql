-- noinspection SqlNoDataSourceInspection
-- Remove the built-in voice settings only. Historical voice-sourced content,
-- the test application role and Alice OAuth infrastructure are preserved.
-- Drop the exact obsolete overload before its referenced column, without CASCADE.
drop function if exists app.update_current_user_preferences(text, text, boolean);

alter table app.users drop column voice_assistant_enabled;
alter table app.workspaces drop column wake_word_training_mode_enabled;

-- Keep the existing non-voice preference entry point unambiguous and scoped to
-- authenticated subjects. Column-level grants for surviving settings remain.
revoke all on function app.update_current_user_preferences(text, text) from public;
grant execute on function app.update_current_user_preferences(text, text)
  to authenticated;
