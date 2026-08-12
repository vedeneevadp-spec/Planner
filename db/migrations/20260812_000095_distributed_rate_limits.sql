-- Authentication and MCP limits must be shared by every API process. Only a
-- one-way hash of the logical bucket key is stored; email and IP values never
-- enter this table in plaintext.

create table if not exists app.rate_limit_buckets (
  bucket_key text primary key,
  request_count integer not null,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint rate_limit_buckets_count_check check (request_count > 0)
);

create index if not exists rate_limit_buckets_reset_idx
  on app.rate_limit_buckets (reset_at);

revoke all on table app.rate_limit_buckets from public, authenticated;

create or replace function app.consume_rate_limit_bucket(
  target_bucket_key text,
  max_requests integer,
  window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = app, pg_catalog, pg_temp
as $$
declare
  bucket_count integer;
  bucket_reset_at timestamptz;
begin
  if target_bucket_key is null
    or char_length(target_bucket_key) <> 64
    or target_bucket_key !~ '^[0-9a-f]{64}$'
    or max_requests < 1
    or max_requests > 100000
    or window_seconds < 1
    or window_seconds > 604800
  then
    raise exception 'Invalid rate limit bucket parameters.'
      using errcode = '22023';
  end if;

  insert into app.rate_limit_buckets as bucket (
    bucket_key,
    request_count,
    reset_at,
    updated_at
  )
  values (
    target_bucket_key,
    1,
    clock_timestamp() + make_interval(secs => window_seconds),
    clock_timestamp()
  )
  on conflict (bucket_key) do update
  set
    request_count = case
      when bucket.reset_at <= clock_timestamp() then 1
      else least(bucket.request_count + 1, max_requests + 1)
    end,
    reset_at = case
      when bucket.reset_at <= clock_timestamp()
      then clock_timestamp() + make_interval(secs => window_seconds)
      else bucket.reset_at
    end,
    updated_at = clock_timestamp()
  returning request_count, reset_at
  into bucket_count, bucket_reset_at;

  if random() < 0.01 then
    delete from app.rate_limit_buckets
    where reset_at < clock_timestamp() - interval '1 day';
  end if;

  return query select
    bucket_count <= max_requests,
    greatest(
      1,
      ceil(extract(epoch from bucket_reset_at - clock_timestamp()))::integer
    );
end;
$$;

revoke all on function app.consume_rate_limit_bucket(text, integer, integer)
  from public;
grant execute on function app.consume_rate_limit_bucket(text, integer, integer)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_runtime') then
    grant execute on function app.consume_rate_limit_bucket(text, integer, integer)
      to planner_runtime;
  end if;
end;
$$;
