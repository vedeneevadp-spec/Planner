-- Concurrent sign-ups into a database without an active owner used to pick
-- 'owner' in every transaction and fail on users_single_owner_idx. The owner
-- choice is now serialized with a transaction-scoped advisory lock and checked
-- again after the lock is taken. Signature, security definer, search_path and
-- grants are unchanged (create or replace keeps the ACL), so the previous
-- release keeps calling this function as before. Google sign-in creates users
-- through this function too.
create or replace function app.auth_create_user_with_credential(
  input_user_id uuid,
  input_email public.citext,
  input_display_name text,
  input_password_hash text
)
returns table (
  id uuid,
  email public.citext,
  display_name text
)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  resolved_app_role app.app_role := 'user';
begin
  if not exists (
    select 1
    from users as user_row
    where user_row.app_role = 'owner'
      and user_row.deleted_at is null
  ) then
    -- Released at commit or rollback, after the new owner row becomes visible.
    perform pg_advisory_xact_lock(hashtextextended('app.users:first_owner', 0));

    -- Read committed: this statement sees an owner committed by the
    -- transaction that held the lock before us.
    if not exists (
      select 1
      from users as user_row
      where user_row.app_role = 'owner'
        and user_row.deleted_at is null
    ) then
      resolved_app_role := 'owner';
    end if;
  end if;

  insert into users (
    app_role,
    display_name,
    email,
    id,
    locale,
    timezone
  )
  values (
    resolved_app_role,
    input_display_name,
    lower(input_email::text)::public.citext,
    input_user_id,
    'ru-RU',
    'Asia/Novosibirsk'
  );

  insert into auth_credentials (
    email,
    password_hash,
    user_id
  )
  values (
    lower(input_email::text)::public.citext,
    input_password_hash,
    input_user_id
  );

  return query
    select
      user_row.id,
      user_row.email,
      user_row.display_name
    from users as user_row
    where user_row.id = input_user_id;
end;
$$;
