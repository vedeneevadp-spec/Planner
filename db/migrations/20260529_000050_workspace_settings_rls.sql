grant update (
  task_completion_confetti_enabled,
  wake_word_training_mode_enabled
) on table app.workspaces to authenticated;

drop policy if exists workspaces_update_settings_admin on app.workspaces;
create policy workspaces_update_settings_admin
on app.workspaces
for update
to authenticated
using (
  (select app.workspace_is_accessible(id))
  and (select app.current_user_app_role()) in ('owner', 'admin')
  and deleted_at is null
)
with check (
  (select app.workspace_is_accessible(id))
  and (select app.current_user_app_role()) in ('owner', 'admin')
  and deleted_at is null
);
