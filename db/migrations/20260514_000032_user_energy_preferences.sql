alter table app.users
  add column if not exists energy_mode text not null default 'normal';

alter table app.users
  drop constraint if exists users_energy_mode_check;

alter table app.users
  add constraint users_energy_mode_check
    check (energy_mode in ('minimum', 'normal', 'maximum'));
