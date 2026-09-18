# Проверка промежуточного code-first релиза на схеме000105

Результат: **PASS**. Новый API/session/backups совместим с прежней схемой; можно планировать двухэтапный выпуск A→B без интервала «старый код запрашивает уже удалённые столбцы».

- Создана отдельная `voice_compat` в существующем временном контейнере `planner-voice-removal-db-20260918`, localhost:55439. Никакие существующие БД не перезаписывались.
- Применена только историческая цепочка: 106 SQL-файлов, максимальный номер `20260916_000105_task_resource_unknown.sql`;000106/000107 НЕ применены. Обе устаревшие колонки подтверждены в information_schema, defaults true/false сохранены.
- Полный PostgreSQL набор нового кода на старой схеме: **94 PASS, 0 FAIL, 2 SKIP**. Пропущены ровно opt-in fresh/upgrade migration specs; они ранее реально прошли2/2 на отдельных новых БД. Session contracts, actual old/current backup restore и остальные PostgreSQL regression checks проходят.
- Отдельно новый API реально запущен с PostgreSQL000105 и проверен HTTP injection: GET session возвращает оба legacy значения false, voice-only PATCH не изменяет ни version, ни updated_at, ни исходный true в БД; смешанный legacy+ordinary PATCH сохраняет calendar/energy/timezones/notifications, workspace PATCH сохраняет confetti/timezone и игнорирует retired setting. Оба исходных DB booleans остались true, то есть игнорирование проверено фактически.
- Новый export со старой схемы НЕ содержит удалённых полей; legacy archive с обоими true успешно нормализован и восстановлен через реальный Postgres repository. Восстановлены task, Alice purchase source voice, profile/calendar/energy/timezones/time mode, workspace settings. Повторный export/import roundtrip проходит. Устаревшие поля в старой схеме при restore также остались нетронутыми.
- Все fixtures этой отдельной проверки удалены. БД voice_compat и контейнер оставлены до завершения root E2E.

Логи:

- `/tmp/planner-voice-db-compat-migrations.log`
- `/tmp/planner-voice-db-compat-postgres.log`
- `/tmp/planner-voice-db-compat-http-backup.log`

## Рекомендуемый выпуск

**A** — новый код удаления голоса/legacy adapters/backup compatibility, но без новых миграций000106/000107 в deploy artifact. Guarded deploy видит прежнюю цепочку и переключает код на старой схеме. Его совместимость доказана выше. Предсуществующая OAuth SQL ошибка ещё не исправлена на этом этапе; не считать A конечным результатом.

**B** — добавить000106/000107 и выполнить следующий guarded deploy. Перед переключением release pipeline применит миграции, пока работает A: A уже не обращается к удаляемым колонкам и поддерживает старые backup поля. После миграций обязательны health/session/settings/Alice OAuth smoke и release verification.

**Откат B → A** безопасен по схеме: A совместим и со старой, и с новой схемой,000107 OAuth fix следует сохранить. Откат к версии ДО A после000106 требует отдельной согласованной компенсации схемы; простое переключение на старые бинарники недопустимо. Production/deploy в этой задаче не выполнялся.

Завершение окружения: после всех root E2E временный контейнер с его volume и БД удалён, локальные dev-серверы остановлены.
