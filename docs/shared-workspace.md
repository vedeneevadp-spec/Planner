# Shared Workspace

Документ описывает текущую реализацию `Shared Workspace` в кодовой базе.
Это не продуктовая спецификация "как должно быть", а карта того, как модель
ролей, прав и сценариев работает сейчас.

Если код и этот документ расходятся, источником истины остается код. После
любого изменения `workspace`-модели, ролей, инвайтов или session flow этот
документ нужно обновить в том же change set.

## Ключевые принципы

- backend остается единственной точкой чтения и записи; web не пишет напрямую в
  Postgres/Supabase
- доступ проверяется в двух слоях: прикладные проверки в API и Postgres
  RLS, когда он включен
- любой пользователь работает внутри конкретного `workspace`, выбранного в
  session
- `personal` и `shared` workspace имеют разное поведение в UI и разные правила
  доступа
- участие в `shared` workspace управляется через membership, group role и
  жизненный цикл приглашений
- удаление участников и инвайтов сейчас soft-delete, чтобы membership можно
  было восстановить повторным приглашением

## Модель доступа

В системе есть три разных измерения прав. Их нельзя смешивать.

| Слой                                   | Поле        | Значения                                 | Для чего используется                                  |
| -------------------------------------- | ----------- | ---------------------------------------- | ------------------------------------------------------ |
| Глобальный уровень приложения          | `appRole`   | `owner`, `admin`, `user`, `guest`        | доступ к admin-функциям приложения                     |
| Уровень membership в workspace         | `role`      | `owner`, `admin`, `user`, `guest`        | базовый доступ к workspace и часть legacy/RLS логики   |
| Уровень группы внутри shared workspace | `groupRole` | `group_admin`, `senior_member`, `member` | фактические права участников внутри `shared` workspace |

### 1. `appRole`

Глобальная роль живет на пользователе, а не на membership.

- `owner` - единственный глобальный владелец приложения
- `admin` - может менять `workspace settings`
- `user` - обычный пользователь
- `guest` - ограниченный пользователь без admin-возможностей

Важно: `appRole` не делает пользователя owner конкретного `workspace`.

### 2. `workspace role`

`workspace role` живет в `workspace_members.role` и возвращается в session как
`role`.

Текущие значения:

- `owner`
- `admin`
- `user`
- `guest`

Для `Shared Workspace` это поле сейчас не является главным пользовательским
рычагом управления правами:

- создатель shared workspace получает `role = owner`
- участник, принятый по инвайту, получает `role = user`
- текущий пользовательский flow не выдает и не редактирует `role = admin`
  отдельно от `groupRole`
- текущий пользовательский flow не создает shared-участников с `role = guest`

Иными словами: в `shared` workspace прикладные права почти полностью завязаны
на `groupRole`, а `role` нужен для owner-case и для части базовой DB/RLS модели.

### 3. `groupRole`

`groupRole` существует только для `shared` workspace.

- `group_admin`
- `senior_member`
- `member`

Это основная роль для повседневной работы внутри общего пространства.

## Workspace kinds

Система различает два типа workspace:

- `personal`
- `shared`

`personal` workspace создается автоматически для нового authenticated
пользователя, если у него еще нет membership и он не запросил конкретный
workspace.

`shared` workspace создается явно через API/UI и предназначен для совместной
работы.

## Session и выбор workspace

Session всегда возвращает:

- текущий `workspace`
- текущие `role` и `groupRole`
- список всех доступных `workspaces`

Если `x-workspace-id` не передан, backend выбирает первый доступный membership
по порядку создания workspace и времени вступления.

На клиенте выбранный workspace запоминается в `localStorage` отдельно для
каждого `actorUserId`. Это позволяет одному и тому же браузеру помнить разные
последние workspace для разных аккаунтов.

## Жизненный цикл Shared Workspace

### Создание

`POST /api/v1/workspaces/shared` создает новый shared workspace.

Текущее поведение:

- у одного пользователя может быть не больше трех shared workspace
- если имя не передано, backend задает `Shared Workspace N`
- создатель становится:
  - `role = owner`
  - `groupRole = group_admin`
- настройка `taskCompletionConfettiEnabled` включается по умолчанию

Отдельной явной проверки роли на уровне API для создания shared workspace в
текущей реализации нет. Фактически ограничение сейчас состоит из наличия session и
лимита в три shared workspace на пользователя.

### Приглашения

Приглашение создается по email и group role.

- уникальность: одно активное приглашение на `workspace + email`
- повторное приглашение того же email не создает дубль, а переоткрывает и
  обновляет существующую запись
- если пользователь уже является участником workspace, API возвращает `409`

Приглашение хранит только `groupRole`. Отдельное поле `role` в invitation flow
уже убрано из актуальной модели.

### Автоматическое принятие приглашения

Активное приглашение принимается автоматически во время authenticated session
resolution, если email в auth-профиле совпал с email приглашения.

При принятии:

- если membership не было, создается новое membership с:
  - `role = user`
  - `groupRole = invitation.groupRole`
- если membership было soft-deleted, оно восстанавливается
- invitation помечается как принятый и исчезает из списка активных приглашений

Отдельного ручного экрана "Принять приглашение" сейчас нет.

### Удаление участника и отзыв приглашения

- удаление участника помечает membership через `deleted_at`
- отзыв приглашения помечает invitation через `deleted_at`
- повторное приглашение может восстановить ранее удаленное membership

## Матрица прав

Ниже описано текущее фактическое поведение.

| Действие                                   | `personal`                  | `shared owner`                                                                | `group_admin`                                                                       | `senior_member`                                             | `member`                                             |
| ------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Читать данные своего workspace             | да                          | да                                                                            | да                                                                                  | да                                                          | да                                                   |
| Видеть список участников shared workspace  | нет                         | да                                                                            | да                                                                                  | да                                                          | да                                                   |
| Писать planner-данные workspace            | любой `role`, кроме `guest` | да                                                                            | да                                                                                  | да                                                          | да                                                   |
| Приглашать участников                      | нет                         | да                                                                            | да                                                                                  | нет                                                         | нет                                                  |
| Видеть pending invites                     | нет                         | да                                                                            | да                                                                                  | нет                                                         | нет                                                  |
| Менять `groupRole` участника               | нет                         | да                                                                            | да                                                                                  | нет                                                         | нет                                                  |
| Удалять участника                          | нет                         | да                                                                            | да                                                                                  | нет                                                         | нет                                                  |
| Назначать задачи на пользователя           | нет                         | да                                                                            | да                                                                                  | да                                                          | да                                                   |
| Редактировать или переносить shared-задачу | н/д                         | да, если owner не назначен исполнителем в этой задаче или является ее автором | да, если group_admin не назначен исполнителем в этой задаче или является ее автором | только если senior_member является автором задачи           | только если member является автором задачи           |
| Менять статус shared-задачи                | н/д                         | да                                                                            | да                                                                                  | если senior_member является автором или исполнителем задачи | если member является автором или исполнителем задачи |
| Удалять задачу в shared workspace          | н/д                         | owner или автор задачи                                                        | group_admin или автор задачи                                                        | только автор задачи                                         | только автор задачи                                  |
| Управлять задачей с флагом подтверждения   | н/д                         | да                                                                            | да                                                                                  | только если senior_member является автором задачи           | только если member является автором задачи           |
| Завершать задачу с флагом подтверждения    | н/д                         | только если owner является автором задачи                                     | только если group_admin является автором задачи                                     | только если senior_member является автором задачи           | только если member является автором задачи           |

### Что считается записью в workspace

Ограничение `canWriteWorkspaceContent` используется для модулей, которые пишут
данные workspace:

- tasks
- life spheres / compatibility projects
- task templates
- daily plan
- chaos inbox

Для `shared` workspace запись разрешена:

- `owner`
- `group_admin`
- `senior_member`
- `member`

Для `personal` workspace запись запрещена только `role = guest`.

### Ограничения participant management

Даже owner/group admin не могут:

- менять `groupRole` владельца workspace
- менять собственный `groupRole`
- удалять владельца workspace
- удалять самих себя

Для этих сценариев в коде явно ожидаются отдельные ownership/leave flow, но они
еще не реализованы.

### Назначение задач

Назначение задачи пользователю разрешено только внутри `shared` workspace.

Дополнительно:

- `assigneeUserId` должен ссылаться на активного участника текущего workspace
- в `personal` workspace назначение задачи отклоняется ошибкой

### Статусы и подтверждение задач

Для `shared` workspace у задач есть дополнительный статус:

- `ready_for_review`

В UI он показывается как `Готово к проверке`.

Также при создании и редактировании задачи в `shared` workspace доступен флаг
`Требуется подтверждение`.

Для любой задачи в `shared` workspace:

- автор задачи может управлять своей задачей полностью
- `owner` и `group_admin` могут управлять любой задачей, если они не назначены
  в ней исполнителем
- исполнитель задачи может менять только статусы `in_progress` и
  `ready_for_review`
- любой другой участник видит задачу только в режиме чтения

Если флаг включен:

- перевести задачу в `done` может только автор задачи
- правило не применяется к `personal` workspace

### Удаление задач

Для `shared` workspace удаление задач ограничено явным бизнес-правилом:

- автор задачи может удалить свою задачу
- `owner` workspace может удалить любую задачу
- `group_admin` может удалить любую задачу

Обычные участники (`senior_member`, `member`) не могут удалять чужие задачи.

## Глобальные admin-права

Часть операций не зависит от `groupRole` и проверяется только через `appRole`.

| Действие                                        | Кто может                     |
| ----------------------------------------------- | ----------------------------- |
| Менять `workspace settings`                     | `appRole = admin` или `owner` |
| Управлять глобальными пользователями приложения | только `appRole = owner`      |

На текущий момент `workspace settings` содержат только
`taskCompletionConfettiEnabled`.

## UI-поведение shared workspace

`Shared Workspace` сейчас намеренно урезан в интерфейсе по сравнению с
personal workspace.

- router оставляет только маршрут `/today`
- переходы на другие страницы редиректятся обратно на `/today`
- в sidebar при shared workspace скрываются `timeline` и `spheres`
- в composer, шаблонах и карточках задач shared workspace не показывается привязка к сферам/проектам
- кнопка `Участники` появляется только для shared workspace
- composer задач показывает выбор исполнителя только в shared workspace
- composer задач показывает флаг `Требуется подтверждение` только в shared workspace
- карточка задачи в shared workspace показывает автора задачи
- в shared workspace кнопка перевода задачи в статус `Готово к проверке` доступна только для задач с флагом `Требуется подтверждение`

Это значит, что shared workspace сейчас сфокусирован на совместной работе вокруг
дневного потока задач, а не на полном наборе экранов personal workspace.

## Безопасность и источник истины

Права проверяются в двух слоях:

1. API-сервисы проверяют бизнес-правила, например:
   - кто может писать данные
   - кто может управлять участниками
   - где разрешено назначение задач
2. Postgres RLS ограничивает доступ к строкам для authenticated runtime.

При включенном RLS backend прокидывает эффективные JWT claims в Postgres session
или transaction context. Даже когда RLS отключен для конкретного runtime,
прикладные проверки остаются обязательными.

## Известные текущие ограничения

- нет ownership transfer flow
- нет leave workspace flow для текущего пользователя
- нет отдельного UI для ручного принятия или отклонения приглашения
- shared workspace ограничен маршрутом `/today`
- `workspace role` и `groupRole` сосуществуют одновременно, но в shared runtime
  пользовательские права в основном завязаны на `groupRole`

## Как обновлять этот документ

При любом изменении shared workspace проверьте и при необходимости обновите этот
файл вместе с кодом.

Минимальный чек-лист:

1. Контракты:
   - `packages/contracts/src/api.ts`
2. Миграции и DB-модель:
   - `supabase/migrations/20260423_000015_shared_workspaces.sql`
   - `supabase/migrations/20260427_000017_workspace_invitations.sql`
   - `supabase/migrations/20260427_000018_workspace_group_roles_and_task_assignees.sql`
   - `supabase/migrations/20260423_000014_workspace_roles_admin_users.sql`
   - `supabase/migrations/20260424_000016_app_roles.sql`
   - `supabase/migrations/20260416_000003_auth_rls_foundation.sql`
3. Серверные проверки доступа и session flow:
   - `apps/api/src/shared/workspace-access.ts`
   - `apps/api/src/modules/session/session.service.ts`
   - `apps/api/src/modules/session/session.repository.postgres.ts`
   - `apps/api/src/modules/tasks/task.service.ts`
   - `apps/api/src/modules/tasks/task.repository.postgres.ts`
4. Клиентское поведение:
   - `apps/web/src/app/router/AppRouter.tsx`
   - `apps/web/src/widgets/sidebar/ui/Sidebar.tsx`
   - `apps/web/src/features/session/ui/WorkspaceParticipantsDialog.tsx`
   - `apps/web/src/features/session/lib/workspace-selection.ts`
   - `apps/web/src/features/task-create/ui/TaskComposer.tsx`
5. Тесты:
   - `apps/api/src/bootstrap/build-app.test.ts`
   - `apps/web/src/features/session/lib/*.test.ts`

Если изменение затрагивает правила ролей или прав, обновляйте сначала код и
контракты, потом этот документ и тесты. Не оставляйте документацию в состоянии
"потом допишем": она быстро становится ложной.
