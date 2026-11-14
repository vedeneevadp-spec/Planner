-- Install backup access at migration time, before the first Google sign-in.
-- Keep 000112 unchanged because it has already been applied locally.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'app'
      and tablename = 'auth_google_identities'
      and policyname = 'planner_backup_select_all'
  ) then
    create policy planner_backup_select_all on app.auth_google_identities
      for select to public using (session_user = 'planner_backup');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'app'
      and tablename = 'auth_google_nonce_uses'
      and policyname = 'planner_backup_select_all'
  ) then
    create policy planner_backup_select_all on app.auth_google_nonce_uses
      for select to public using (session_user = 'planner_backup');
  end if;
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    grant select on app.auth_google_identities, app.auth_google_nonce_uses to planner_backup;
  end if;
end;
$$;
