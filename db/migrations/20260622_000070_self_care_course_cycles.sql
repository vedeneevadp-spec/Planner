alter table app.self_care_course_details
  add column if not exists repeat_after_completion boolean not null default false,
  add column if not exists break_days integer not null default 0;

alter table app.self_care_course_details
  drop constraint if exists self_care_course_break_days_nonnegative,
  add constraint self_care_course_break_days_nonnegative
    check (break_days >= 0);
