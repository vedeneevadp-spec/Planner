-- The scheduled logical backup connects as planner_backup. Timeweb's SELECT
-- database privilege grants table access but intentionally does not bypass RLS.
-- Give only that login a permissive SELECT policy while keeping every write
-- privilege and application function unavailable to the backup credential.

do $$
declare
  target record;
begin
  for target in
    select
      namespace.nspname as schema_name,
      relation.relname as relation_name
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app'
      and relation.relkind in ('p', 'r')
      and relation.relrowsecurity
    order by relation.relname
  loop
    execute format(
      'drop policy if exists planner_backup_select_all on %I.%I',
      target.schema_name,
      target.relation_name
    );
    execute format(
      'create policy planner_backup_select_all on %I.%I as permissive for select to public using (session_user = %L)',
      target.schema_name,
      target.relation_name,
      'planner_backup'
    );
  end loop;
end;
$$;
-- PostgreSQL functions are executable by PUBLIC unless explicitly revoked.
-- Preserve the application's existing authenticated access, then remove the
-- generic surface and the backup login's provider-generated EXECUTE grants.
grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'planner_backup') then
    revoke execute on all functions in schema app from planner_backup;
  end if;
end;
$$;
