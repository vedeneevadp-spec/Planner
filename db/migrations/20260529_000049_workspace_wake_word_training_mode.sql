alter table app.workspaces
  add column if not exists wake_word_training_mode_enabled boolean not null default false;
