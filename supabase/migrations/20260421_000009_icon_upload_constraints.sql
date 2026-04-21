-- noinspection SqlNoDataSourceInspection
update app.emoji_sets
set
  source = 'custom',
  updated_at = now()
where source <> 'custom';

update app.emoji_assets
set
  deleted_at = coalesce(deleted_at, now()),
  updated_at = now()
where kind <> 'image'
  and deleted_at is null;

alter table app.emoji_sets
  drop constraint if exists emoji_sets_source_custom_check;

alter table app.emoji_sets
  add constraint emoji_sets_source_custom_check
  check (source = 'custom');

alter table app.emoji_assets
  drop constraint if exists emoji_assets_active_image_check;

alter table app.emoji_assets
  add constraint emoji_assets_active_image_check
  check (deleted_at is not null or kind = 'image');
