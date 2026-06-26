update app.self_care_occurrences
set status = 'scheduled',
    updated_at = now(),
    version = version + 1
where status = 'missed'
  and completed_at is null;
