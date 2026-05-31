-- Allow authenticated members to keep operating on chaos inbox tombstones.
-- Application queries still filter deleted rows explicitly.

drop policy if exists chaos_inbox_items_select_member on app.chaos_inbox_items;
create policy chaos_inbox_items_select_member
on app.chaos_inbox_items
for select
to authenticated
using (
  (select app.workspace_is_accessible(workspace_id))
);
