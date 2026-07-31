# Пользовательские резервные копии

## Назначение

Авторизованный пользователь может скачать переносимую копию личного
пространства, проверить ее и применить безопасное merge-восстановление.
Пользовательский архив не заменяет инфраструктурный disaster recovery всей
системы. Системный контур описан в
[disaster-recovery.md](./disaster-recovery.md).

Поддерживается только восстановление в того же пользователя и то же личное
пространство, из которых архив был экспортирован.

## Пользовательский сценарий

В разделе `/more` доступны операции:

1. `Скачать копию` создает JSON-архив `planner.user-backup` версии 1.
2. `Проверить файл` читает архив, проверяет схему, scope, ссылки и ассеты, но не
   меняет данные.
3. `Восстановить данные` появляется только для архива с `canRestore=true`.
4. Перед применением UI явно сообщает merge-правила и предупреждает об удалении
   несинхронизированных локальных изменений.
5. После успеха очищаются IndexedDB cache и offline queues только текущего
   workspace, приложение перезагружается и показывает итог операции.

Размер выбранного файла проверяется до чтения. Максимальный размер HTTP payload
равен 20 MiB. Дополнительно ограничены количество строк, число ассетов, размер
одного ассета и общий размер ассетов.

## API

- `GET /api/v1/backups/export`
- `POST /api/v1/backups/import/preview`
- `POST /api/v1/backups/import/restore`

Restore требует:

- действующий JWT;
- заголовок `x-workspace-id`;
- заголовок `Idempotency-Key` длиной 16-128 символов;
- literal confirmation `RESTORE_PERSONAL_BACKUP`;
- архив того же `userId`, `workspaceId` и `personal workspace`.

Повтор запроса с тем же key и тем же digest возвращает сохраненный успешный
ответ. Использование того же key для другого архива возвращает `409`.

## Merge-правила

Restore выполняется под workspace advisory lock и в одной PostgreSQL
транзакции.

- Отсутствующие строки вставляются с исходными UUID.
- Активные локальные строки сохраняются без изменений.
- Soft-deleted строки возвращаются и получают значения из архива.
- Локальные строки, которых нет в архиве, не удаляются.
- Профиль обновляется только по allowlist безопасных полей. Email, auth identity,
  user ID и app role не импортируются.
- Workspace обновляется только по allowlist настроек. Owner, slug, kind и
  workspace ID не импортируются.
- Membership проверяется, но ownership и роли не переписываются.
- Циклические task references применяются отдельным проходом после вставки
  задач и chains.
- Файлы аватара публикуются content-addressed и не перезаписывают файл с другим
  содержимым.
- Созданный asset удаляется, если DB-транзакция откатывается.

Метаданные `task_attachments` остаются в архиве, но restore их пропускает:
объекты приватного attachment storage в JSON не включены. Итоговый ответ явно
показывает число `skipped`.

Глобальные `emoji_sets`, `emoji_assets` и `emoji_asset` payload блокируют
restore. Это системные данные, а не данные отдельного пользователя.

## Привилегированное подключение

Production runtime использует non-owner `DATABASE_URL`, которому намеренно
запрещены прямые записи во внутренние таблицы. Restore использует отдельный пул:

```text
USER_BACKUP_RESTORE_DATABASE_URL
```

Deploy требует, чтобы URL был настроен и не совпадал с runtime `DATABASE_URL`.
Доступ должен принадлежать отдельной maintenance/restore роли или owner/admin
role. Этот credential используется только restore repository; обычные API
операции продолжают работать через strict RLS runtime connection.

Перед atomic switch deploy запускает `npm run backup:restore-db:check` и
проверяет read-write connection, наличие таблиц, table privileges и возможность
обхода RLS. Текущая реализация привилегированной транзакции не поддерживает роль,
которая видит только обычные authenticated RLS policies.

Если отдельное подключение не настроено, production restore возвращает `503`
без изменения данных.

## Формат архива

Формат: `planner.user-backup`, версия `1`.

Архив содержит:

- время экспорта и версию приложения;
- `userId`, `workspaceId`, kind и имя workspace;
- domain-строки текущего пользователя и workspace;
- payload локального profile avatar, если на него есть ссылка.

Экспорт выполняется в `REPEATABLE READ READ ONLY` snapshot. Для задач действует
ограничение истории:

- soft-deleted задачи не экспортируются;
- выполненные задачи включаются за последние 14 дней;
- открытые, активные и запланированные задачи включаются;
- task children экспортируются только для вошедших в архив задач.

## Входящие данные

В архив входят:

- безопасные поля профиля, workspace и membership;
- сферы, задачи, task chains, time blocks, occurrences и attachment metadata;
- task templates и daily plans;
- chaos inbox и shopping items;
- уборка, привычки и их история;
- self-care items, schedules, occurrences, completions, settings и detail
  tables;
- связанный profile avatar.

Не входят:

- password hashes, refresh/reset tokens и OAuth authorization codes;
- MCP OAuth tokens и audit logs;
- push tokens, device sessions, sync cursors и outbox;
- delivery/runtime jobs, которые пересоздаются из domain state;
- системные self-care templates;
- глобальная emoji library и ее файлы;
- бинарные объекты task attachments.

## Проверка архива

Preview и restore отклоняют архив при следующих нарушениях:

- scope отличается от текущего пользователя или workspace;
- отсутствует scoped user/workspace anchor;
- есть неизвестная таблица, колонка или malformed UUID/timestamp;
- превышены limits;
- обнаружены duplicate identifiers;
- строки выходят за user/workspace scope;
- parent reference не замкнута внутри архива;
- daily plan ссылается на отсутствующую задачу;
- asset path повторяется, отсутствует или небезопасен;
- base64, `byteLength`, MIME и magic bytes не согласованы;
- присутствует глобальный emoji content.

Raw archive не сохраняется в audit table. Таблица
`app.user_backup_restore_operations` хранит scope, idempotency key, SHA-256
digest, статус и итоговый summary.

## Ограничения

Пока не поддерживаются:

- destructive replace-restore;
- восстановление shared workspace;
- cross-account/cross-workspace import и remap identity;
- восстановление бинарных task attachments;
- восстановление глобальной emoji library.

Replace-restore должен быть отдельной операцией с server-side restore point,
дополнительной авторизацией, dry-run diff и отдельным подтверждением.
