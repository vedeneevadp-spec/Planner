alter table app.workspaces
  add column if not exists task_completion_confetti_enabled boolean not null default true;
