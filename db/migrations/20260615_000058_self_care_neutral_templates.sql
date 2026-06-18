update app.self_care_templates
set
  title = 'Стрижка',
  description = 'Каждые 6 недель после выполнения.',
  category = 'beauty'::app.self_care_category,
  default_schedule = '{"repeatKind":"after_completion","intervalValue":6,"intervalUnit":"week"}'::jsonb,
  default_steps = array[]::text[],
  updated_at = now()
where id = 'system-self-care-template-3';

update app.self_care_templates
set
  title = 'Массаж',
  description = 'Каждые 4 недели после выполнения.',
  category = 'relax'::app.self_care_category,
  default_schedule = '{"repeatKind":"after_completion","intervalValue":4,"intervalUnit":"week"}'::jsonb,
  default_steps = array[]::text[],
  updated_at = now()
where id = 'system-self-care-template-4';

update app.self_care_templates
set
  title = 'Утренний минимум',
  description = 'Короткий чеклист для старта дня.',
  category = 'daily_base'::app.self_care_category,
  default_steps = array[
    'умыться',
    'вода',
    'лекарства или витамины',
    'SPF',
    'план дня'
  ]::text[],
  updated_at = now()
where id = 'system-self-care-template-6';

update app.self_care_templates
set
  title = 'Вечернее восстановление',
  category = 'sleep'::app.self_care_category,
  default_steps = array[
    'душ или умывание',
    'подготовить вещи',
    'отложить экран',
    'короткая пауза',
    'лечь вовремя'
  ]::text[],
  updated_at = now()
where id = 'system-self-care-template-7';

update app.self_care_templates
set
  title = 'Пауза 20 минут',
  updated_at = now()
where id = 'system-self-care-template-10';
