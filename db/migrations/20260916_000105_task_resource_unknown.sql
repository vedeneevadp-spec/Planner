-- The previous web picker stored an empty selection as numeric zero and did
-- not offer an explicit neutral choice. Preserve uncertainty for legacy zeros;
-- their origin (blank UI or an API-supplied neutral value) is not recoverable.
-- New clients store a blank selection as NULL and explicit neutral as 0.
-- Keep normal version bumps so stale offline writes receive a conflict.
update app.tasks
set resource = null
where resource = 0;
