alter table app.projects
  add column if not exists description text not null default '',
  add column if not exists icon text not null default '📁';
