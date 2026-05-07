alter table app.users
  add column if not exists auth_user_id uuid;
