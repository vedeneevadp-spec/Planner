# Техдолг проекта

Дата анализа: 2026-05-21. Обновлено: 2026-06-24.

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

## Закрыто 2026-05-28: локальные quality gates синхронизированы

Где было видно:

- `npm run test:e2e` падал на calendar composer layout test: тест искал кнопку
  `Создать задачу` / `Новая задача`, а calendar FAB имел accessible name
  `Задача`
- `.github/workflows/ci.yml` запускал `npm run ci` до `db:migrate`, хотя
  `npm run ci` включает Postgres coverage gates
- web coverage thresholds в `apps/web/vite.config.ts` оставались ниже
  фактического покрытия и слабо защищали от регрессий
- часть этого документа оставалась открытой, хотя auth-specific release criteria
  уже были перенесены в `docs/release-workflow.md` и ADR 0002

Статус: calendar composer получил отдельный `aria-label="Создать задачу"` при
компактной визуальной подписи `Задача`, CI сначала мигрирует Postgres и задает
job-level `DATABASE_URL` / `API_DB_RLS_MODE`, для workspace actions добавлены
focused web tests, а глобальные web coverage thresholds подняты до текущего
контролируемого уровня.

Статус 2026-06-22: web thresholds актуализированы в
`apps/web/vite.config.ts`: statements/lines `65.5`, functions `66`, branches
`61`.
Документ очищен от устаревшего открытого auth release пункта.

## Закрыто 2026-06-04: npm audit gates восстановлены

Где было видно:

- `npm run audit:prod` падал на high severity advisory в
  `react-router`/`react-router-dom`
- `npm run audit:dev-tooling` падал на собственном инварианте
  `@capacitor/assets devDependency was not found`, хотя проект запускает
  assets generator через pinned `npx --yes @capacitor/assets@3.0.5`

Проблема: root `npm run ci` начинается с production/dev audit gates, поэтому
любой CI/release прогон останавливался до lint, typecheck и tests. Второй сбой
маскировал реальные неожиданные audit findings, потому что script проверял
`@capacitor/assets` до классификации найденных уязвимостей.

Статус 2026-06-04: `react-router-dom` обновлен до безопасной minor-линейки
`^7.16.0`, lockfile пересчитан. `scripts/audit-dev-tooling.mjs` теперь сначала
отдельно показывает неожиданные vulnerabilities, а dev-only инвариант
`@capacitor/assets` принимает либо devDependency, либо pinned `npx` script.
`npm run audit:prod` и `npm run audit:dev-tooling` должны оставаться зелеными
перед остальными quality gates.

## Закрыто 2026-06-22: toolchain drift переведен в явный preflight

Где было видно:

- `package.json`: `packageManager: npm@11.9.0`, `engines.node >=24.14.0 <25`
- `.nvmrc` и `.node-version`: `24.14.0`
- локальная managed-среда могла запускать команды на Node `24.13.0` и
  npm `11.6.2`
- каждый npm-вызов печатал
  `Unknown env config "min-release-age"`, потому что окружение инжектило
  неподдерживаемый npm env config

Проблема: package metadata и README требовали один runtime, но обычные
`npm run check` / `npm run ci` могли стартовать на другом Node/npm и доходить
до тестов. Это создавало onboarding/CI parity риск и маскировало причину
`min-release-age` warning.

Статус: добавлен `scripts/check-toolchain.mjs` и команда
`npm run toolchain:check`. `npm run check` и `npm run ci` теперь начинаются с
этого preflight. GitHub Actions после `actions/setup-node` явно ставит
`npm@11.9.0` перед `npm ci`, поэтому CI использует `.nvmrc` и пакетный npm.
README описывает проверку и объясняет warning `min-release-age`.
`toolchain:check` также падает, если в окружении выставлен
`NPM_CONFIG_MIN_RELEASE_AGE` / `npm_config_min_release_age`, чтобы unsupported
npm config не оставался фоновой warning-строкой. `engine-strict` не включен
намеренно: он не проверяет точную npm-версию и дает менее понятный сигнал, чем
project-specific preflight.

## Закрыто 2026-06-22: документация синхронизирована с текущим проектом

Где было видно:

- README указывал React Router DOM `7.14`, хотя `apps/web/package.json`
  использует `^7.16.0`
- `docs/tech-debt.md` ссылался на старый inventory hotspots и старые web
  coverage thresholds
- текущий анализ показал новые hotspots: self-care UI/backend, AI context,
  ручной OpenAPI layer, bundle budget и строгий RLS local/CI parity

Статус: README обновлен до React Router DOM `7.16` и описывает
`toolchain:check`. Этот документ обновлен как living backlog на 2026-06-22:
зафиксированы актуальные thresholds, новый self-care hotspot, RLS/toolchain
preflight и bundle/mobile asset budget risk.

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

- `apps/web/src/pages/self-care/ui/SelfCarePage.components.tsx` - 4561 строка
- `apps/api/src/bootstrap/build-app.test.ts` - 3691 строка
- `apps/api/src/modules/self-care/self-care.repository.postgres.ts` - 2724
  строки
- `packages/contracts/src/voice-test-corpus/corpus.ts` - 2133 строки
- `apps/api/src/bootstrap/openapi-paths.ts` - 2123 строки
- `apps/api/src/modules/self-care/self-care.shared.ts` - 2073 строки
- `apps/api/src/modules/ai-context/ai-context.service.ts` - 2034 строки
- `apps/web/src/pages/self-care/ui/SelfCarePage.module.css` - 1882 строки
- `packages/contracts/src/planner-intent.ts` - 1783 строки
- `apps/api/src/bootstrap/openapi-components.ts` - 1628 строк
- `apps/web/src/pages/calendar/ui/CalendarPage.tsx` - 1425 строк
- `apps/api/src/modules/session/session.repository.postgres.ts` - 1359 строк
- `apps/api/src/modules/tasks/task.repository.postgres.ts` - 1295 строк
- `apps/web/src/features/voice-assistant/model/useVoiceActionFlow.ts` - 866
  строк
- `apps/web/src/features/voice-assistant/model/voice-action-reschedule-handler.ts` -
  623 строки
- `apps/web/src/features/voice-assistant/model/planner-action-executor.ts` -
  306 строк
- `apps/web/src/features/voice-assistant/ui/VoiceAssistant.tsx` - 227 строк

Проблема: большие файлы смешивают data access, policy, mapping, optimistic UI,
error handling и runtime integration. Это повышает стоимость ревью и риск
случайных регрессий.

Актуальный смещенный риск 2026-06-22: самые крупные hotspots теперь не только
auth/session repositories и voice. Главная стоимость изменений ушла в
self-care UI/backend, AI context aggregation и ручной OpenAPI слой:

- `SelfCarePage.tsx` и `SelfCarePage.components.tsx` держат query/mutation
  orchestration, URL-state, tabs, dialogs, forms, keyboard handling и
  presentation в одном page surface
- `self-care.repository.postgres.ts` и `self-care.shared.ts` смешивают loading
  strategy, persistence mapping, occurrence generation, dashboard/plan/history/
  analytics projections и migration compatibility
- `ai-context.service.ts` агрегирует tasks, shopping, cleaning, habits,
  self-care и calendar context для MCP/AI surfaces
- `openapi-paths.ts` и `openapi-components.ts` остаются ручным описанием API
  рядом с Zod contracts; часть DTO все еще описана как generic JSON object
- `build-app.test.ts` проверяет много route-групп одним большим test harness,
  что повышает стоимость локального изменения API shell
- page CSS modules (`SelfCarePage.module.css`, `CalendarPage.module.css`,
  `CleaningPage.module.css`, `Sidebar.module.css`) разрастаются без отдельного
  style budget/lint gate

Что сделать:

- дробить не по вкусу, а по устойчивым границам: state machine, API boundary,
  cache policy, UI shell, mapping
- сначала покрывать текущие сценарии тестами, затем переносить код малыми
  механическими шагами
- не проводить большие рефакторы auth/session без отдельного mobile regression
  плана
- для self-care сначала вынести tabs/dialogs/forms и page controller, сохранив
  текущие tests как behavioral baseline
- для backend self-care выделять read models/projections и repository loading
  profiles без изменения HTTP contracts
- для voice продолжать дробить `useVoiceActionFlow` по устойчивым границам:
  action session reducer, parser/executor adapter, confirmation card adapter и
  Android notification side effects
- для intent handlers сохранять corpus tests как behavioral baseline; при
  изменении переноса отдельно дробить candidate scoring и schedule resolution
- для OpenAPI постепенно заменять `genericJsonObjectSchema()` на детальные
  схемы из contracts или generated layer; сначала для внешних и mobile-critical
  DTO
- для `build-app.test.ts` разделять route groups и shared fixtures без изменения
  runtime поведения

Статус 2026-06-24: начат self-care page split. URL/search-param состояние,
правила lazy-загрузки вкладок и active-tab loading decision вынесены из
`SelfCarePage.tsx` в `SelfCarePage.model.ts` с focused tests. Query/data
controller вынесен в `SelfCarePage.data.ts`, mutation controller - в
`SelfCarePage.mutations.ts`, tabs/nav shell - в `SelfCarePage.tabs.tsx`.
Размер `SelfCarePage.tsx` уменьшен с 896 до 752 строк без изменения UI/HTTP
поведения. Следующие стабильные границы для малых PR: action handlers,
dialog/form state и затем большие формы из `SelfCarePage.components.tsx`.

Статус 2026-06-04: voice split доведен до orchestration/intent границ.
Вынесены `useVoiceMetrics`, `useAndroidVoiceRuntime`, `useWebVoiceInput` и
`useVoiceActionFlow`; `VoiceAssistant.tsx` стал UI-shell на 227 строк и больше
не держит recorder, Android bridge polling, metrics, parser,
preview/execute/undo и card state. `PlannerActionExecutor` стал thin router на
306 строк: create-task, agenda, shopping и reschedule logic вынесены в
intent-specific handlers, а общие preview/result builders, shopping helpers и
formatting helpers вынесены в отдельные model-модули. Остаточный voice hotspot:
`useVoiceActionFlow.ts` и крупный `voice-action-reschedule-handler.ts`.

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

Статус 2026-05-27: базовые проверки остаются зелеными (`lint`, `typecheck`,
`test:run`, `openapi:check`, production/dev audit). Крупные orchestration-файлы
по-прежнему главный источник стоимости изменений, но риск backend divergence
прикрыт contract matrix и отдельными Postgres coverage gates.

Статус 2026-06-04: inventory обновлен под текущий размер файлов. Voice safety
и parser/action/UI baseline прикрыты `voice-command-corpus.v1` и
`npm run voice-quality-report`; после split главным frontend hotspot остается
`useVoiceActionFlow`, а не `VoiceAssistant`/`PlannerActionExecutor`. Backend
contract matrix продолжает снижать риск repository divergence, а следующим
backend hotspot стал ручной OpenAPI/documentation layer.

Статус 2026-06-22: inventory обновлен повторно после роста self-care и
MCP/AI-context surfaces. Новые P1 targets для малых PR: self-care page split,
self-care backend read model split и постепенная замена ручных OpenAPI generic
schemas на contract-derived schemas.

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
- постепенно свести planner/habits/shopping offline queues к общему adapter
  вместо копирования статусов, drain и conflict policy в каждом домене

Статус 2026-05-27: первый общий adapter добавлен в
`apps/web/src/shared/lib/offline-sync/offline-sync.ts`. Planner, habits и
shopping-list drain теперь используют общий lifecycle для получения retryable
мутаций, перевода в `syncing`, завершения и обхода очереди; доменные файлы
оставляют за собой apply-логику и conflict/error policy.

Статус 2026-05-27: shopping-list queue получила terminal `conflicted`-статус
для `chaos_inbox_item_not_found`. Такие операции больше не остаются в retryable
очереди бесконечно; после terminal conflict shopping-list invalidates query
cache и подтягивает серверный список. Следующий шаг здесь - общий feature-level
status/UX для offline queue health, чтобы planner/habits/shopping одинаково
показывали ожидающие и конфликтные операции.

## P2: качество сопровождения

### Закрыто 2026-05-28: auth-specific release criteria

Release workflow уже ссылается на ADR 0002, требует `npm run test:mobile-auth`
для auth/session/mobile restore изменений и фиксирует ручной
`mobile:auth-smoke` для installed-app сценариев. Этот пункт больше не открыт;
оставшийся риск по auth описан ниже как диагностика refresh/restore, а не как
отсутствие release criteria.

### Нужен строгий RLS CI profile для non-owner runtime role

Проблема: обычный CI поднимает локальный PostgreSQL с owner-пользователем
`planner`. `npm run db:security:check` в таком режиме проверяет RLS policies и
`transaction_local`, но owner-bypass остается warning, если не задан
`DB_SECURITY_REQUIRE_NON_OWNER=1`.

Что сделать:

- добавить отдельный CI step/job, который запускает `db:runtime-role:setup`
  против локального Postgres
- прогонять `DB_SECURITY_REQUIRE_NON_OWNER=1 npm run db:security:check` под
  runtime non-owner `DATABASE_URL`
- оставить быстрый owner-based Postgres job для миграций и contract tests, но
  не считать его строгой RLS parity проверкой

Статус 2026-06-23: GitHub Actions quality job после миграций запускает
`db:runtime-role:setup`, затем отдельный
`DB_SECURITY_REQUIRE_NON_OWNER=1 npm run db:security:check` под
`planner_runtime` `DATABASE_URL`. Owner-based Postgres job сохранен для
миграций, contract tests и production smoke.

### Нужен bundle/mobile asset budget шире initial JS

Проблема: `npm run build:budget` уже защищает initial JS и forbidden preload,
но не ограничивает route chunks, CSS, public bitmap assets и итоговый Android
artifact. На 2026-06-22 production build проходит с initial JS около `865.8 KB`
при лимите `900 KB`, а локальный `android/app/src/main/assets` после sync
содержит web assets и wake-word models примерно на `17 MB`.

Что сделать:

- добавить route-level budgets для `self-care`, `calendar`, `VoiceAssistant` и
  `planner-contracts`
- добавить budget для `apps/web/public/self-care/**` или общий public asset
  budget перед mobile sync
- для Android release добавить APK/AAB size check в `mobile:release` или
  отдельный CI smoke, чтобы ONNX/TFLite/web assets не росли незаметно

Статус 2026-06-23: `npm run build:budget` дополнительно проверяет route-level
JS/CSS для `self-care`, `calendar`, `VoiceAssistant`, JS для
`planner-contracts` и `lottie_light_canvas`, а также public asset budgets для
`apps/web/public/self-care/**` и `apps/web/public/icons/**`. На текущем build
проходят лимиты: initial JS `870.1 KB`, self-care assets `12311.0 KB`, icons
`608.1 KB`.

Статус 2026-06-24: добавлен Android artifact budget. `mobile:release` проверяет
размер реально собранных release APK/AAB после Gradle build, а
`npm run mobile:android:ci` после debug assemble запускает
`npm run mobile:android:budget`. Лимиты задаются через
`ANDROID_DEBUG_APK_MAX_MB`, `ANDROID_RELEASE_APK_MAX_MB` и
`ANDROID_RELEASE_AAB_MAX_MB`; текущие локальные артефакты проходят с debug APK
`153.1 MB`, release APK `55.2 MB`, release AAB `71.4 MB`.

Статус 2026-06-30: initial JS budget получил рабочий запас. `/today` переведен
на lazy route, `entities/task` разделен на model-only public API и отдельный
`@/entities/task/ui`, а `TaskNextStageDialog` в `PlannerProvider` загружается
лениво. Production build теперь проходит с entry JS `241.4 KB` и initial JS
`811.6 KB`; budget tightened до `WEB_BUNDLE_ENTRY_JS_MAX_KB=250` и
`WEB_BUNDLE_INITIAL_JS_MAX_KB=835`.

### Нужна лучшая диагностика refresh/restore

Проблема: когда мобильное приложение показывает "connected but empty", сейчас
сложно быстро отличить storage race, 401, SQL failure, stale refresh replay и
ошибку feature query.

Что сделать:

- логировать категории auth restore/refresh decision без секретов
- добавлять migration/function version в server-side auth diagnostics
- в клиенте различать retryable, revoked, stale replay и storage unavailable

Статус 2026-06-23: клиентская диагностика расширена через существующий
`__CHAOTIKA_DIAGNOSTICS__` ring buffer. Добавлены события
`auth_restore_decision`, `auth_recovery_decision`, `auth_refresh_failed`,
`auth_refresh_succeeded`, `auth_refresh_storage_decision` и
`auth_storage_failed`; details содержат только категории, status/booleans и
тип команды без access/refresh token и email. Regression tests теперь проверяют
`retryable`, `revoked_or_denied`, `stale_refresh_replay` и
`storage_unavailable`. Открытым остается server-side auth diagnostics с
версией миграций/runtime functions в `HttpError.details`.

### Закрыто 2026-06-28: production DB grant drift получил штатный repair path

Где было видно:

- production deploy мог упасть на `db:security:check`, если у роли
  `authenticated` остались прямые grants на внутренние таблицы без RLS:
  `app.device_sessions`, `app.outbox`, `app.schema_migrations`,
  `app.sync_cursors`
- repair до этого выполнялся ручным SQL после диагностики production grants

Статус: добавлен `npm run db:security:repair`. Скрипт подключается через
`MIGRATE_DATABASE_URL` или `DATABASE_URL`, снимает прямые privileges с
`authenticated` и `public` только для известных internal tables, чистит default
privileges для владельцев этих таблиц и печатает безопасный summary без
секретов. `db:security:check` теперь явно подсказывает эту команду для
internal table grant drift.

### Закрыто 2026-06-28: часть low-coverage web hotspots закреплена guard-ом

Где было видно:

- `useWorkspaceParticipants.ts` имел нулевое покрытие и содержал nullable error
  crash path
- `TimeZoneChangeBanner.tsx` имел нулевое покрытие
- `native-push-notifications.ts` был покрыт только примерно на `6%`
- `useSelfCare.ts` был покрыт примерно на `8%`

Статус: добавлены focused tests для workspace participant hooks, timezone
change banner, Android native push registration/unregister и self-care query /
mutation invalidation. Web coverage после изменений: общий lines `69.08%`,
`native-push-notifications.ts` `68.65%`, `TimeZoneChangeBanner.tsx` `83.78%`,
`useSelfCare.ts` `17.31%`, `useWorkspaceParticipants.ts` `37.61%`.
`scripts/check-web-coverage-hotspots.mjs` закрепляет эти минимумы.

### Нужна постепенная нормализация parsing/mapping helpers

Проблема: в проекте много boundary-кода с JSON/unknown/mapping логикой. Это
нормально для API-heavy приложения, но без общих helper-паттернов ошибки
границ становятся невидимыми до runtime.

Что сделать:

- выносить повторяемые parser/mapping helpers рядом с contracts
- добавлять negative tests на malformed payloads для критичных caches и API
  boundaries
- не расширять ad hoc parsing в auth/session без тестов

### Migration hygiene больше не должен зависеть от ручного внимания

Проблема: в истории есть applied migration
`20260527_000028_task_reminder_offsets.sql`, которая повторяет sequence
`000028` после уже существующей `20260512_000028_cleaning.sql`. Runner
сортирует файлы по имени и хранит checksum, поэтому текущая история применима,
но новые повторы или откаты sequence легко пропустить на ревью.

Статус 2026-05-27: добавлен `npm run db:migrations:check`, он проверяет формат
имен, новые дубли и монотонность sequence. Исторический applied-дубль оставлен
в явном allowlist, чтобы не переименовывать уже примененный SQL-файл без
отдельного rollout-плана. Проверка включена в `npm run check`.
