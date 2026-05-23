# Техдолг проекта

Дата анализа: 2026-05-21. Обновлено: 2026-05-23.

Цель документа - зафиксировать риски, которые повышают вероятность повторных
регрессий в авторизации, mobile runtime, offline/cache и основных planner flows.

## Закрыто 2026-05-23: production DB RLS переведен в строгий режим

Где было видно:

- production `/etc/planner/planner.env`: `API_DB_RLS_MODE=claims_only`
- production runtime DB user `gen_user` владеет app tables и не может
  `SET ROLE authenticated`
- `scripts/db-security-check.mjs`
- `docs/incidents/2026-05-10-production-rls-role.md`

Проблема: API передает JWT claims в Postgres context, но production runtime user
остается table owner. Это совместимый режим после RLS-инцидента, но он не дает
полноценной защиты от owner bypass и не проверяет production в том же режиме,
в котором должен работать strict RLS.

Что сделать:

- разделить runtime `DATABASE_URL` и owner/admin `MIGRATE_DATABASE_URL`
- создать non-owner runtime DB role, которая является member роли
  `authenticated` и может `SET ROLE authenticated`
- перевести production `API_DB_RLS_MODE` на `transaction_local`
- запускать `db:security:check` с `DB_SECURITY_REQUIRE_NON_OWNER=1`
- для maintenance workers использовать отдельный worker DB URL, потому что они
  выполняются без JWT subject

Статус 2026-05-23: production переключен на strict RLS. `planner-api` работает с
`API_DB_RLS_MODE=transaction_local` и runtime non-owner DB user `authenticated`.
Owner/admin URL сохранен в `MIGRATE_DATABASE_URL` для backup, migrations и smoke
cleanup; `planner-task-reminders` работает через maintenance DB URL, потому что
worker выполняется без JWT subject. `db:security:check` проходит с
`DB_SECURITY_REQUIRE_NON_OWNER=1`, production smoke и публичный health прошли.
Runbook обновлен: ручные команды на VPS запускаются через `npm run prod:env`, а
не через shell-source `/etc/planner/planner.env`.

## P0: риск повторного логаута на мобильном

### Auth lifecycle размазан по нескольким слоям

Где видно:

- `apps/web/src/features/session/ui/SessionProvider.tsx` - 14 строк
- `apps/web/src/features/session/lib/useSessionAuthController.ts`
- `apps/web/src/features/session/lib/session-auth-machine.ts`
- `apps/web/src/features/session/ui/AuthGate.tsx`
- `apps/web/src/features/session/ui/AuthGate.model.ts`
- `apps/web/src/features/session/lib/usePlannerSession.ts`
- `apps/web/src/features/session/lib/planner-session-cache.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.repository.postgres.ts`
- `db/migrations/*auth*`

Исходная проблема: restore, refresh, native resume, cached planner session,
access token, workspace selection и sign-out жили в разных местах. Из-за этого
локальная правка могла выглядеть безопасной, но фактически менять поведение
старта мобильного приложения.

Что сделать:

- выделить явную auth/session state machine или reducer с состояниями
  `signedOut`, `restoring`, `usable`, `deferred`, `revoked`, `signingOut`
- сделать единый контракт `SessionReadiness`, который используют `AuthGate`,
  sidebar и feature hooks
- запретить очистку native auth storage вне явного sign-out и verified revoke
- покрыть state machine table-driven тестами

Статус 2026-05-22: restore, refresh, native resume, refresh timer и native
storage recovery вынесены в явную `session-auth-machine` с event/command
переходами и table-driven тестами. React-эффекты остались в
`useSessionAuthController`, а `SessionProvider` стал тонким context provider.
`AuthGate` использует отдельную `AuthGate.model` decision-модель и остается
рендерящим слоем. В web-клиенте также есть явный auth lifecycle status
`authenticated` / `deferred` / `disabled` / `restoring` / `signed_out` и общий
флаг `canUseProtectedApi`.

Статус 2026-05-22: добавлен общий read model `SessionReadiness` со статусами
`ready`, `restoringWithCache`, `blockedAuth`, `offlineWithCache`,
`serverError`. Его используют sidebar, planner offline sync, planner API client
и shopping-list hooks вместо самостоятельной интерпретации `isLoading`,
`lifecycleStatus`, `canUseProtectedApi`, session error и cache fallback.
Сценарии покрыты table-driven тестом `session-readiness.test.ts`, который входит
в `npm run test:mobile-auth`.

Статус 2026-05-23: общий helper `useSessionFeatureReadiness` стал единой точкой
для feature API readiness. На него переведены habits, cleaning, emoji library,
admin/workspace participant queries и native push registration, поэтому feature
hooks больше не решают готовность через локальное
`session && auth.canUseProtectedApi`. Table-driven тесты покрывают ready,
disabled, restoring и planner-error сценарии для feature API gating.

Статус 2026-05-23: rollout доведен до planner, shopping-list и native planner
widget. `usePlannerState`, `usePlannerApiClient`, `useShoppingList` и
`NativePlannerWidgetSync` больше не собирают feature API readiness из
`session`, `canUseProtectedApi`, `plannerApiConfig` или прямого
`resolveSessionReadiness`; API clients строятся через `useSessionFeatureReadiness`.
Planner offline drain использует `readiness.canWriteProtectedData`.

### Auth SQL functions слишком критичны для текущего уровня защиты тестами

Где видно:

- `apps/api/src/modules/auth/auth.repository.postgres-spec.ts`
- `db/migrations/*auth_runtime_functions*`

Проблема: refresh-token rotation теперь зависит от SQL runtime functions. Ошибка
в одной функции может выглядеть как нормальная 401/refresh failure и приводить к
массовому разлогину на мобильных устройствах.

Что сделать:

- добавить postgres specs для всех auth runtime functions, а не только replay
  refresh-token path
- ввести SQL naming rule: PL/pgSQL variables and output columns use prefixes;
  no names that can conflict with built-ins or table columns
- проверять cases: expired, revoked, stale replay same device, stale replay
  different device, malformed metadata, concurrent refresh

Текущий первый шаг: postgres spec для `auth_rotate_refresh_token` расширен на
active rotation, expired token, revoked token, same-client stale replay,
different-client stale replay, malformed/overlong metadata, concurrent refresh
и SQL signature/naming drift check. Native refresh-token runtime получил
стабильный `deviceId` установленного приложения: новые refresh tokens сохраняют
`device_id`, same-device replay сравнивает его вместо user-agent, а user-agent
остается только legacy fallback для старых токенов без `device_id`.

### Нет отдельного mobile auth regression gate

Где видно:

- `tests/e2e/auth-task.spec.ts` - единственный e2e-файл
- `docs/release-workflow.md` уже отмечает, что installed native apps не
  обновляются обычным web deploy

Проблема: web tests ловят часть поведения, но не гарантируют installed app
startup/resume path. Именно там проявляются access-check flash, storage races и
повторный refresh.

Что сделать:

- добавить mobile smoke checklist в каждый auth release
- добавить Playwright/Capacitor сценарии: already signed in startup, resume,
  offline resume, expired access token, refresh replay
- хранить результат mobile smoke в release notes для auth/session релизов

Текущий первый шаг: добавлен запускаемый gate `npm run test:mobile-auth`,
который объединяет web auth/session regression tests и postgres tests для
refresh-token runtime.

Статус 2026-05-23: закрыто как автоматический regression gate. Gate расширен
installed-app smoke тестом
`npm run test:mobile-installed-auth`. Playwright запускает приложение в
Capacitor-like Android runtime с native `Preferences` storage и проверяет
already-signed-in cold start, native resume, offline resume с истекшим access
token и сохранение device session без возврата на форму входа.

## P1: архитектурная сложность и пустые/ложные состояния

### Крупные orchestration-файлы трудно безопасно менять

Где видно:

- `apps/api/src/modules/session/session.repository.postgres.ts` - 1644 строки
- `apps/web/src/features/habits/lib/useHabits.ts` - 1116 строк
- `apps/web/src/features/planner/model/usePlannerState.ts` - 721 строк
- `apps/web/src/features/session/lib/useSessionAuthController.ts` - 740 строк

Проблема: большие файлы смешивают data access, policy, mapping, optimistic UI,
error handling и runtime integration. Это повышает стоимость ревью и риск
случайных регрессий.

Что сделать:

- дробить не по вкусу, а по устойчивым границам: state machine, API boundary,
  cache policy, UI shell, mapping
- сначала покрывать текущие сценарии тестами, затем переносить код малыми
  механическими шагами
- не проводить большие рефакторы auth/session без отдельного mobile regression
  плана

Статус 2026-05-22: P0/High contract matrix для самых рискованных postgres
repositories закрыта. `SessionRepository`, `TaskRepository` и
`CleaningRepository` получили общие contract suites, которые прогоняются на
memory и postgres реализациях. Матрица покрывает session workspace/admin/
invitation flows вместе с negative cases, task create/list/filter/pagination/
events/update/schedule/delete/transfer flows и cleaning zone/task/action/today
projection flows. Дальнейшее расширение branch coverage для редких error cases
остается поддерживающей задачей, но основной риск divergence между memory и
postgres реализациями теперь прикрыт локальными контрактами.

Статус 2026-05-23: contract matrix расширена на оставшиеся крупные
пользовательские Postgres repositories: habits, emoji sets, life spheres,
daily plans и chaos inbox. Для каждого домена добавлены общий contract suite,
memory test и postgres spec. В процессе выровнены две найденные divergence:
`MemoryLifeSphereRepository` теперь сохраняет idempotent create и
expected-version conflict semantics, а `PostgresEmojiSetRepository` обновляет
родительский icon set при добавлении/удалении items, сохраняя существующую
global-read семантику icon sets.

Статус 2026-05-23: закрыто для P1 visibility. Postgres contract specs получили
отдельный coverage job
`npm run coverage:api:postgres-contracts`. Обычный `npm run coverage:api`
остается быстрым memory/API report, а postgres repository ветки теперь видны в
отдельном отчете по `*.contract.postgres-spec.ts`, без смешивания с unit
coverage.

Статус 2026-05-23: pooler write fallback получил отдельный postgres contract и
coverage gate: `npm run test:api:postgres:pooler-contracts` и
`npm run coverage:api:postgres-pooler-contracts`. Task contracts в этом режиме
идут с authenticated context и покрывают create/update/status/schedule/delete
ветки `PostgresTaskPoolerWriteFallback`; emoji set contracts покрывают
pooler-фолбэки create/add-items. Gate также зафиксировал soft-delete/RLS
расхождение для emoji assets; добавлена migration с admin select policy для
корректного soft-delete transition без возврата к RLS bypass.

Статус 2026-05-23: auth SQL runtime specs расширены на malformed/overlong
device metadata, concurrent same-device refresh и signature/naming drift check
для `auth_rotate_refresh_token`.

Статус 2026-05-23: legacy actor/workspace overrides ограничены local/test/dev
режимом. Production backend больше не принимает unauthenticated
`x-actor-user-id` как замену bearer token, web production build явно отклоняет
`VITE_ACTOR_USER_ID`/`VITE_WORKSPACE_ID`, mobile release build также запрещает
эти env overrides.

### Состояния "connected", "empty" и "loading" не имеют общего источника правды

Где видно:

- session hooks
- sidebar
- planner/cleaning/habits feature hooks

Проблема: разные части UI могут по-разному трактовать одну и ту же ситуацию:
auth восстанавливается, access token еще не готов, cached session есть, API
вернул session readiness error. В результате пользователь может видеть
"connected", но без иконок, уборки или данных.

Что сделать:

- ввести общий тип состояния приложения: `ready`, `restoringWithCache`,
  `blockedAuth`, `offlineWithCache`, `serverError`
- запретить feature hooks самостоятельно маскировать auth readiness как обычный
  offline/empty state
- отображать empty state только после подтвержденной успешной загрузки данных

Статус 2026-05-23: общий тип состояния введен как `SessionReadiness`, а
feature-level API readiness для planner, sidebar, shopping-list, habits,
cleaning, emoji/admin participant queries, native push и native planner widget
идет через общий helper. Следующий остаточный риск здесь уже не auth readiness,
а более точные empty-state проверки на уровне отдельных страниц после успешной
загрузки данных.

### Offline/cache paths требуют инвентаризации

Где видно:

- `apps/web/src/features/planner/lib/offline-planner-sync.ts`
- `apps/web/src/features/planner/model/usePlannerState.ts`
- planner session cache
- feature-level cache fallbacks

Проблема: кэш нужен для хорошего мобильного UX, но без единой политики он может
создавать "живой" экран поверх невалидной auth/session основы.

Что сделать:

- описать, какие кэши являются UI fallback, а какие могут разрешать действия
- для каждого offline path указать, что происходит без access token
- добавить тесты на запрет protected writes без актуального auth state

## P2: качество сопровождения

### Нужны auth-specific release criteria

Проблема: общий release workflow есть, но auth/session требует отдельной
обязательной секции из-за риска silent logout.

Что сделать:

- ссылаться на ADR 0002 из release workflow
- для auth/session PR требовать список пройденных startup/resume checks
- не выпускать store build с auth changes без mobile smoke

### Нужна лучшая диагностика refresh/restore

Проблема: когда мобильное приложение показывает "connected but empty", сейчас
сложно быстро отличить storage race, 401, SQL failure, stale refresh replay и
ошибку feature query.

Что сделать:

- логировать категории auth restore/refresh decision без секретов
- добавлять migration/function version в server-side auth diagnostics
- в клиенте различать retryable, revoked, stale replay и storage unavailable

### Нужна постепенная нормализация parsing/mapping helpers

Проблема: в проекте много boundary-кода с JSON/unknown/mapping логикой. Это
нормально для API-heavy приложения, но без общих helper-паттернов ошибки
границ становятся невидимыми до runtime.

Что сделать:

- выносить повторяемые parser/mapping helpers рядом с contracts
- добавлять negative tests на malformed payloads для критичных caches и API
  boundaries
- не расширять ad hoc parsing в auth/session без тестов
