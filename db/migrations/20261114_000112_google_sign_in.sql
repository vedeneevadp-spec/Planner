-- Google identities are keyed by the immutable provider subject, never email.
create table app.auth_google_identities (
  subject text primary key check (length(subject) between 1 and 255),
  user_id uuid not null unique references app.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table app.auth_google_nonce_uses (
  nonce_hash text primary key,
  expires_at timestamptz not null
);
create index auth_google_nonce_uses_expiry_idx on app.auth_google_nonce_uses (expires_at);
alter table app.auth_google_identities enable row level security;
alter table app.auth_google_nonce_uses enable row level security;
revoke all on app.auth_google_identities, app.auth_google_nonce_uses from public, authenticated;

create function app.auth_find_google_user(input_subject text)
returns table (id uuid, email public.citext, display_name text)
language sql stable security definer
set search_path = app, pg_catalog, pg_temp
as $$
  select u.id, u.email, u.display_name
  from app.auth_google_identities g join app.users u on u.id = g.user_id
  where g.subject = input_subject and u.deleted_at is null;
$$;

create function app.auth_complete_google_sign_in(
  input_subject text, input_email public.citext, input_display_name text,
  input_new_user_id uuid, input_link_user_id uuid, input_nonce_hash text,
  input_expires_at timestamptz
)
returns table (id uuid, email public.citext, display_name text)
language plpgsql security definer
set search_path = app, pg_catalog, pg_temp
as $$
declare
  resolved_user_id uuid;
  email_user_id uuid;
begin
  if input_expires_at <= now() or input_expires_at > now() + interval '11 minutes' then
    raise exception 'google_challenge_invalid';
  end if;
  delete from app.auth_google_nonce_uses n where n.expires_at < now();
  insert into app.auth_google_nonce_uses (nonce_hash, expires_at)
    values (input_nonce_hash, input_expires_at) on conflict do nothing;
  if not found then raise exception 'google_challenge_invalid'; end if;

  -- Serialize first sign-in for the same Google identity across API workers.
  perform pg_advisory_xact_lock(hashtextextended('google:' || input_subject, 0));
  select g.user_id into resolved_user_id from app.auth_google_identities g
    where g.subject = input_subject;
  if resolved_user_id is null then
    select u.id into email_user_id from app.users u
      where u.email = lower(input_email::text)::public.citext and u.deleted_at is null;
    if email_user_id is not null then
      if input_link_user_id is distinct from email_user_id then
        raise exception 'google_link_required';
      end if;
      resolved_user_id := email_user_id;
    else
      if input_link_user_id is not null then raise exception 'google_account_unavailable'; end if;
      resolved_user_id := input_new_user_id;
      -- An unmatchable credential keeps existing password-reset support available.
      perform app.auth_create_user_with_credential(
        resolved_user_id, input_email, input_display_name, 'external:google'
      );
    end if;
    insert into app.auth_google_identities (subject, user_id)
      values (input_subject, resolved_user_id);
  end if;
  if not exists (select 1 from app.users u where u.id = resolved_user_id and u.deleted_at is null) then
    raise exception 'google_account_unavailable';
  end if;
  return query select u.id, u.email, u.display_name from app.users u where u.id = resolved_user_id;
end;
$$;

revoke all on function app.auth_find_google_user(text) from public, authenticated;
revoke all on function app.auth_complete_google_sign_in(text, public.citext, text, uuid, uuid, text, timestamptz) from public, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_runtime') then
    grant execute on function app.auth_find_google_user(text) to planner_runtime;
    grant execute on function app.auth_complete_google_sign_in(text, public.citext, text, uuid, uuid, text, timestamptz) to planner_runtime;
  end if;
end;
$$;
