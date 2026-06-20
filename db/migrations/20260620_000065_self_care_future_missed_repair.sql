update app.self_care_occurrences
set status = 'scheduled',
    completed_at = null,
    updated_at = now(),
    version = version + 1
where status = 'missed'
  and scheduled_for >= current_date;
