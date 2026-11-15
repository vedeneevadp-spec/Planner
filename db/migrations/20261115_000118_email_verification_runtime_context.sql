-- Managed production connects as authenticated (see 000114). Auth repositories
-- execute outside request-scoped RLS; support that login while preventing these
-- mailbox-proof operations from being invoked within a user claims context.
create or replace function app.auth_email_verification_status(input_user_id uuid)
returns table (email text, verified boolean)
language plpgsql stable security definer
set search_path = app, pg_catalog, pg_temp
as $$
begin
  if app.current_user_id() is not null then
    raise exception 'Mailbox verification requires the API authentication context' using errcode = '42501';
  end if;
  return query select u.email::text, u.email_verified_at is not null
    from app.users u where u.id = input_user_id and u.deleted_at is null;
end;
$$;

create or replace function app.auth_request_email_verification(input_user_id uuid, input_token_hash text, input_expires_at timestamptz)
returns void language plpgsql security definer
set search_path = app, pg_catalog, pg_temp
as $$
begin
  if app.current_user_id() is not null then
    raise exception 'Mailbox verification requires the API authentication context' using errcode = '42501';
  end if;
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

create or replace function app.auth_confirm_email_verification(input_user_id uuid, input_token_hash text)
returns boolean language plpgsql security definer
set search_path = app, pg_catalog, pg_temp
as $$
begin
  if app.current_user_id() is not null then
    raise exception 'Mailbox verification requires the API authentication context' using errcode = '42501';
  end if;
  perform 1 from app.users u where u.id = input_user_id and u.deleted_at is null for update;
  if not found then return false; end if;
  delete from app.auth_email_verification_tokens t
  where t.user_id = input_user_id and t.token_hash = input_token_hash and t.expires_at > now();
  if not found then return false; end if;
  update app.users set email_verified_at = coalesce(email_verified_at, now()) where id = input_user_id;
  return true;
end;
$$;

create or replace function app.verify_email_after_mailbox_proof()
returns trigger language plpgsql security definer
set search_path = app, pg_catalog, pg_temp
as $$
begin
  if app.current_user_id() is not null then
    raise exception 'Mailbox verification requires the API authentication context' using errcode = '42501';
  end if;
  update app.users set email_verified_at = coalesce(email_verified_at, now()) where id = new.user_id;
  return new;
end;
$$;

grant execute on function app.auth_email_verification_status(uuid) to authenticated;
grant execute on function app.auth_request_email_verification(uuid, text, timestamptz) to authenticated;
grant execute on function app.auth_confirm_email_verification(uuid, text) to authenticated;
