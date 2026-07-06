alter table app.self_care_completions
  add column if not exists price numeric(12, 2),
  add column if not exists currency text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'app.self_care_completions'::regclass
      and conname = 'self_care_completions_price_nonnegative'
  ) then
    alter table app.self_care_completions
      add constraint self_care_completions_price_nonnegative
      check (price is null or price >= 0);
  end if;
end
$$;
