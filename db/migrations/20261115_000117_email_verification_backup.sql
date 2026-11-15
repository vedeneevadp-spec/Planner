-- Install the backup policy even when the isolated login is provisioned later.
-- Match the established session_user boundary instead of inherited role access.
drop policy if exists auth_email_verification_backup on app.auth_email_verification_tokens;
create policy planner_backup_select_all on app.auth_email_verification_tokens
  for select to public using (session_user = 'planner_backup');

-- Only the API runtime may issue a proof or read its status for an arbitrary
-- account. The request-scoped RLS role must never mint its own mailbox proof.
revoke all on function app.auth_email_verification_status(uuid) from authenticated;
revoke all on function app.auth_request_email_verification(uuid, text, timestamptz) from authenticated;
revoke all on function app.auth_confirm_email_verification(uuid, text) from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_runtime') then
    grant execute on function app.auth_email_verification_status(uuid) to planner_runtime;
    grant execute on function app.auth_request_email_verification(uuid, text, timestamptz) to planner_runtime;
    grant execute on function app.auth_confirm_email_verification(uuid, text) to planner_runtime;
  end if;
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    grant select on app.auth_email_verification_tokens to planner_backup;
  end if;
end;
$$;
