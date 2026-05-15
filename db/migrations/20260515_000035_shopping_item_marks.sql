-- noinspection SqlNoDataSourceInspection
alter table app.chaos_inbox_items
  add column if not exists is_favorite boolean not null default false,
  add column if not exists shopping_category text;

alter table app.chaos_inbox_items
  drop constraint if exists chaos_inbox_shopping_category_check,
  add constraint chaos_inbox_shopping_category_check
    check (
      shopping_category is null
      or shopping_category in ('groceries', 'household', 'other')
    )
    not valid;

alter table app.chaos_inbox_items
  validate constraint chaos_inbox_shopping_category_check;
