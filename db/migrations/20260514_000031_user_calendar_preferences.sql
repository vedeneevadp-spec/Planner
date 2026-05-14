alter table app.users
  add column if not exists calendar_view_mode text not null default 'week';

alter table app.users
  drop constraint if exists users_calendar_view_mode_check;

alter table app.users
  add constraint users_calendar_view_mode_check
    check (calendar_view_mode in ('week', 'month'));
