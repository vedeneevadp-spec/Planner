-- A claimed email is not proof that its owner accepted a workspace invitation.
alter table app.users add column email_verified_at timestamptz;

-- Only prior mailbox proofs qualify. Password-only accounts remain unverified.
update app.users u set email_verified_at = now()
where exists (select 1 from app.auth_google_identities g where g.user_id = u.id)
   or exists (select 1 from app.auth_password_reset_tokens r where r.user_id = u.id and r.used_at is not null);

create table app.auth_email_verification_tokens (
  user_id uuid primary key references app.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table app.auth_email_verification_tokens enable row level security;
revoke all on app.auth_email_verification_tokens from public, authenticated;

create function app.auth_email_verification_status(input_user_id uuid)
returns table (email text, verified boolean)
language sql stable security definer
set search_path = app, pg_catalog, pg_temp
as $$
  select u.email::text, u.email_verified_at is not null
  from app.users u where u.id = input_user_id and u.deleted_at is null;
$$;

create function app.auth_request_email_verification(input_user_id uuid, input_token_hash text, input_expires_at timestamptz)
returns void language plpgsql security definer
set search_path = app, pg_catalog, pg_temp
as $$
begin
  if input_expires_at <= now() or input_expires_at > now() + interval '31 minutes' then
    raise exception 'Invalid email verification expiry';
  end if;
  perform 1 from app.users u where u.id = input_user_id and u.deleted_at is null for update;
  if not found then raise exception 'User not found'; end if;
  insert into app.auth_email_verification_tokens (user_id, token_hash, expires_at)
  values (input_user_id, input_token_hash, input_expires_at)
  on conflict (user_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = now();
end;
$$;

create function app.auth_confirm_email_verification(input_user_id uuid, input_token_hash text)
returns boolean language plpgsql security definer
set search_path = app, pg_catalog, pg_temp
as $$
begin
  perform 1 from app.users u where u.id = input_user_id and u.deleted_at is null for update;
  if not found then return false; end if;
  delete from app.auth_email_verification_tokens t
  where t.user_id = input_user_id and t.token_hash = input_token_hash and t.expires_at > now();
  if not found then return false; end if;
  update app.users set email_verified_at = coalesce(email_verified_at, now()) where id = input_user_id;
  return true;
end;
$$;

revoke all on function app.auth_email_verification_status(uuid) from public;
revoke all on function app.auth_request_email_verification(uuid, text, timestamptz) from public;
revoke all on function app.auth_confirm_email_verification(uuid, text) from public;
grant execute on function app.auth_email_verification_status(uuid) to authenticated;
grant execute on function app.auth_request_email_verification(uuid, text, timestamptz) to authenticated;
grant execute on function app.auth_confirm_email_verification(uuid, text) to authenticated;

-- All recipient policies, membership insertion/reactivation and invitation
-- acceptance functions already use this boundary. Claims alone never qualify.
create or replace function app.current_user_email()
returns text language sql stable security definer
set search_path = app, pg_catalog, pg_temp
as $$
  select u.email::text from app.users u
  where u.id = (select app.current_user_id())
    and u.deleted_at is null and u.email_verified_at is not null;
$$;

create function app.verify_email_after_mailbox_proof()
returns trigger language plpgsql security definer
set search_path = app, pg_catalog, pg_temp
as $$
begin
  update app.users set email_verified_at = coalesce(email_verified_at, now()) where id = new.user_id;
  return new;
end;
$$;
revoke all on function app.verify_email_after_mailbox_proof() from public;
create trigger auth_google_identity_verifies_email after insert on app.auth_google_identities
for each row execute function app.verify_email_after_mailbox_proof();
create trigger auth_password_reset_verifies_email after update of used_at on app.auth_password_reset_tokens
for each row when (old.used_at is null and new.used_at is not null)
execute function app.verify_email_after_mailbox_proof();

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    grant select on app.auth_email_verification_tokens to planner_backup;
    create policy auth_email_verification_backup on app.auth_email_verification_tokens for select to planner_backup using (true);
  end if;
end $$;
