create table app.google_play_testing_campaign (
  id boolean primary key default true check (id),
  is_open boolean not null default false
);
insert into app.google_play_testing_campaign (id) values (true);

create table app.google_play_testing_requests (
  user_id uuid primary key references app.users(id) on delete cascade,
  google_email text not null check (
    char_length(google_email) between 3 and 254
    and google_email = lower(btrim(google_email))
    and google_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  status text not null default 'pending' check (status in ('pending', 'invited')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app.google_play_testing_campaign enable row level security;
alter table app.google_play_testing_requests enable row level security;
revoke all on app.google_play_testing_campaign, app.google_play_testing_requests from public, authenticated;
grant select on app.google_play_testing_campaign, app.google_play_testing_requests to authenticated;

create function app.can_manage_google_play_testing() returns boolean
language sql stable security definer set search_path = app, pg_catalog, pg_temp
as $$
  select exists (select 1 from app.users where id = app.current_user_id()
    and deleted_at is null and app_role in ('owner', 'admin'));
$$;
revoke all on function app.can_manage_google_play_testing() from public;
grant execute on function app.can_manage_google_play_testing() to authenticated;

create policy google_play_campaign_read on app.google_play_testing_campaign
  for select to authenticated using (app.current_user_id() is not null);
create policy google_play_request_read on app.google_play_testing_requests
  for select to authenticated using (
    user_id = (select app.current_user_id()) or (select app.can_manage_google_play_testing())
  );
create policy planner_backup_select_all on app.google_play_testing_campaign
  for select to public using (session_user = 'planner_backup');
create policy planner_backup_select_all on app.google_play_testing_requests
  for select to public using (session_user = 'planner_backup');

create function app.google_play_testing_list() returns setof app.google_play_testing_requests
language sql stable security definer set search_path = app, pg_catalog, pg_temp
as $$
  select r.* from app.google_play_testing_requests r
  join app.users u on u.id = r.user_id and u.deleted_at is null
  where r.user_id = app.current_user_id() or app.can_manage_google_play_testing()
  order by r.created_at, r.user_id;
$$;
revoke all on function app.google_play_testing_list() from public;
grant execute on function app.google_play_testing_list() to authenticated;

create function app.google_play_testing_submit(p_email text) returns setof app.google_play_testing_requests
language plpgsql security definer set search_path = app, pg_catalog, pg_temp
as $$
declare v_user_id uuid := app.current_user_id();
begin
  perform 1 from app.users where id = v_user_id and deleted_at is null for update;
  if not found then raise insufficient_privilege; end if;
  -- Serialize with closing recruitment; existing invitations remain readable.
  perform 1 from app.google_play_testing_campaign where id and is_open for share;
  if not found then return; end if;
  return query insert into app.google_play_testing_requests as r (user_id, google_email)
    values (v_user_id, lower(btrim(p_email)))
    on conflict (user_id) do update set
      google_email = excluded.google_email,
      status = case when r.google_email = excluded.google_email then r.status else 'pending' end,
      revision = case when r.google_email = excluded.google_email then r.revision else r.revision + 1 end,
      updated_at = case when r.google_email = excluded.google_email then r.updated_at else now() end
    returning *;
end;
$$;

create function app.google_play_testing_review(p_user_id uuid, p_revision integer, p_status text)
returns setof app.google_play_testing_requests
language plpgsql security definer set search_path = app, pg_catalog, pg_temp
as $$
begin
  if not app.can_manage_google_play_testing() then raise insufficient_privilege; end if;
  return query update app.google_play_testing_requests
    set status = p_status, revision = revision + 1, updated_at = now()
    where user_id = p_user_id and revision = p_revision
    returning *;
end;
$$;

create function app.google_play_testing_set_open(p_open boolean) returns void
language plpgsql security definer set search_path = app, pg_catalog, pg_temp
as $$
begin
  if not app.can_manage_google_play_testing() then raise insufficient_privilege; end if;
  update app.google_play_testing_campaign set is_open = p_open where id;
end;
$$;

revoke all on function app.google_play_testing_submit(text) from public;
revoke all on function app.google_play_testing_review(uuid, integer, text) from public;
revoke all on function app.google_play_testing_set_open(boolean) from public;
grant execute on function app.google_play_testing_submit(text) to authenticated;
grant execute on function app.google_play_testing_review(uuid, integer, text) to authenticated;
grant execute on function app.google_play_testing_set_open(boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    grant select on app.google_play_testing_campaign, app.google_play_testing_requests to planner_backup;
    revoke execute on function app.can_manage_google_play_testing() from planner_backup;
    revoke execute on function app.google_play_testing_list() from planner_backup;
    revoke execute on function app.google_play_testing_submit(text) from planner_backup;
    revoke execute on function app.google_play_testing_review(uuid, integer, text) from planner_backup;
    revoke execute on function app.google_play_testing_set_open(boolean) from planner_backup;
  end if;
end;
$$;
