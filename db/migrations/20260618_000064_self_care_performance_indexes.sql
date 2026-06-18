create index if not exists self_care_item_alternatives_item_idx
  on app.self_care_item_alternatives(item_id);

create index if not exists self_care_ritual_steps_item_order_idx
  on app.self_care_ritual_steps(item_id, sort_order);

create index if not exists self_care_ritual_step_completions_completion_idx
  on app.self_care_ritual_step_completions(completion_id);

create index if not exists self_care_ritual_step_completions_step_idx
  on app.self_care_ritual_step_completions(step_id);

create index if not exists self_care_procedure_details_item_idx
  on app.self_care_procedure_details(item_id);

create index if not exists self_care_appointment_details_item_idx
  on app.self_care_appointment_details(item_id);

create index if not exists self_care_appointment_details_occurrence_idx
  on app.self_care_appointment_details(occurrence_id)
  where occurrence_id is not null;

create index if not exists self_care_medical_details_item_idx
  on app.self_care_medical_details(item_id);

create index if not exists self_care_course_details_item_idx
  on app.self_care_course_details(item_id);

create index if not exists self_care_occurrences_user_status_scheduled_idx
  on app.self_care_occurrences(user_id, status, scheduled_for);

create index if not exists self_care_completions_user_item_completed_idx
  on app.self_care_completions(user_id, item_id, completed_at);

create index if not exists self_care_completions_occurrence_idx
  on app.self_care_completions(occurrence_id)
  where occurrence_id is not null;
