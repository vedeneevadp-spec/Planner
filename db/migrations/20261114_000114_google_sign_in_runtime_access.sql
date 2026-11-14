-- Managed production connects as authenticated; other API runtime logins
-- inherit this role. Match the existing password-auth SECURITY DEFINER API
-- instead of assuming that the optional planner_runtime login exists.
-- Token and password verification remains in GoogleAuthService. No direct
-- table access or PUBLIC/backup execution is granted.
grant execute on function app.auth_find_google_user(text) to authenticated;
grant execute on function app.auth_complete_google_sign_in(text, public.citext, text, uuid, uuid, text, timestamptz) to authenticated;
