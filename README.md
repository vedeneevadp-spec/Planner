# Planner

Monorepo для Planner/Chaotika: React-клиент, Fastify API, shared contracts и
SQL-first схема PostgreSQL.

## Стек

- React 19, React Router 7, Vite 8
- TypeScript strict mode
- Fastify 5, Kysely, PostgreSQL
- Timeweb Managed PostgreSQL как production data store
- Chaotika Auth: email/password, JWT, refresh tokens и password reset
- TanStack Query и Dexie на клиенте
- Vitest, Node test runner, ESLint, Prettier, Husky, lint-staged
- GitHub Actions CI

## Требования

- Node `>=24.14.0 <25`
- npm `11.9.0`
- Docker для локального Postgres

Версии Node зафиксированы в `.nvmrc` и `.node-version`.

## Быстрый запуск

Локальный Postgres:

```bash
npm ci
npm run dev:local
```

`npm run dev:local` поднимает Docker Postgres, применяет миграции, обновляет
dev seed и запускает API на `http://127.0.0.1:3001` вместе с web через Vite
на `http://127.0.0.1:5173`. Значения для web можно взять из
`apps/web/.env.example`; без `.env` клиент использует локальный API по
умолчанию. Production runtime использует Timeweb PostgreSQL и Chaotika Auth.

## Основные скрипты

Полный список находится в `package.json`.

| Команда                                           | Назначение                                              |
| ------------------------------------------------- | ------------------------------------------------------- |
| `npm run dev:local`                               | Postgres + migrations + seed + API + web для разработки |
| `npm run dev` / `npm run start`                   | dev-сервер web-приложения                               |
| `npm run preview`                                 | preview production-сборки web                           |
| `npm run dev:api`                                 | API в watch-режиме                                      |
| `npm run dev:api:postgres`                        | API с локальным Docker Postgres                         |
| `npm run start:api`                               | единичный запуск API                                    |
| `npm run smoke:api:prod`                          | production-mode smoke API против локального Postgres    |
| `npm run db:up` / `npm run db:down`               | поднять/остановить локальный Postgres                   |
| `npm run db:backup`                               | снять `pg_dump` backup в `backups/` или `DB_BACKUP_DIR` |
| `npm run db:migrate` / `npm run db:seed`          | применить миграции и dev seed локально                  |
| `npm run db:security:check`                       | проверить RLS/security-инварианты PostgreSQL            |
| `npm run db:setup`                                | `db:up` + migrations + seed                             |
| `npm run outbox:run`                              | обработать одну пачку outbox-сообщений                  |
| `npm run task-reminders:worker`                   | отдельный long-running worker напоминаний               |
| `npm run lint` / `npm run lint:fix`               | ESLint                                                  |
| `npm run format:check` / `npm run format`         | Prettier                                                |
| `npm run typecheck`                               | typecheck web, contracts и API                          |
| `npm run test:web:run` / `npm run test:api`       | web/API тесты                                           |
| `npm run test:api:postgres`                       | Postgres/RLS integration-тесты API                      |
| `npm run test:e2e`                                | Playwright smoke web + API auth/tasks                   |
| `npm run test:run`                                | web + API тесты                                         |
| `npm run coverage`                                | web coverage                                            |
| `npm run openapi:check`                           | контрактная проверка `/api/openapi.json`                |
| `npm run audit:prod`                              | audit runtime-зависимостей без dev tooling              |
| `npm run audit:dev-tooling`                       | контроль известных dev-only audit исключений            |
| `npm run build`                                   | production-сборка web                                   |
| `npm run mobile:sync`                             | production build web + sync в `ios/` и `android/`       |
| `npm run mobile:release -- --api-url=...`         | подготовить и при флагах собрать native release         |
| `npm run mobile:release:rustore -- --api-url=...` | собрать signed APK для RuStore                          |
| `npm run mobile:assets`                           | пересобрать нативные icons/splash из `assets/logo.png`  |
| `npm run mobile:open:ios` / `mobile:open:android` | открыть нативный проект в Xcode / Android Studio        |
| `npm run mobile:doctor`                           | проверить состояние Capacitor toolchain                 |
| `npm run mobile:ci-check`                         | проверить app id, версии и PWA/mobile config            |
| `npm run check`                                   | lint + typecheck + tests                                |
| `npm run ci`                                      | audit + check + OpenAPI + mobile config + build         |
| `npm run deploy:prod`                             | production deploy на текущий VPS                        |

## Структура

```text
apps/
  web/         React/Vite клиент
  api/         Fastify API и backend-модули
packages/
  contracts/   shared DTO, zod-схемы и API-контракты
db/
  migrations/  SQL-миграции PostgreSQL
deploy/
  caddy/       production Caddyfile
  systemd/     production systemd units для API и workers
scripts/       локальные DB, mobile и deploy workflows
```

## Документация

- [docs/architecture.md](docs/architecture.md) - архитектурные границы проекта
- [docs/release-workflow.md](docs/release-workflow.md) - цикл разработки и
  релиза
- [docs/release-notes.md](docs/release-notes.md) - пользовательские заметки к
  релизам

## API Runtime

API строится как modular monolith поверх Fastify. Основные route-группы:

- public: `/api/health`, `/api/metrics`, `/api/openapi.json`, `/api/docs`,
  `/api/v1/icon-assets/:fileName`, `/api/v1/alice/webhook`
- session: `/api/v1/session`
- planner: `/api/v1/tasks`, `/api/v1/tasks/page`, `/api/v1/task-events`
- сферы: `/api/v1/life-spheres`, `/api/v1/life-spheres/weekly-stats`
- compatibility project API: `/api/v1/projects`
- templates: `/api/v1/task-templates`
- capture: `/api/v1/chaos-inbox`
- daily planning: `/api/v1/daily-plan`
- emoji/icon library: `/api/v1/emoji-sets`
- profile assets: `/api/v1/profile-assets/:fileName`
- push notifications: `/api/v1/push/devices`, `/api/v1/push/test`

### Alice skill webhook

Навык Алисы подключается к backend URL:
`https://chaotika.ru/api/v1/alice/webhook`.

Webhook поддерживает команды создания задач:

- `добавь задачу позвонить завтра`
- `добавь задачу купить молоко завтра`
- `добавь задачу купить молоко завтра в 9 часов`
- `надо купить молоко`
- `нужно купить хлеб`
- `добавь в список покупок сыр`
- `запиши сыр в покупки`
- `прочитай задачи на сегодня`
- `какие задачи на завтра`
- `помощь`, `что ты умеешь`, `выход`

Команды `надо купить ...` и явные команды списка покупок пишутся в
`/api/v1/chaos-inbox` с `kind: "shopping"` и `source: "voice"`. Команды
`добавь задачу ...` пишутся в `/api/v1/tasks`.

Для записи в личное рабочее пространство webhook проверяет Chaotika JWT из
заголовка `Authorization: Bearer <token>` или из
`session.user.access_token`, который Яндекс Диалоги передают после связки
аккаунта. Если токена нет, а поверхность поддерживает account linking, webhook
возвращает top-level `start_account_linking` без поля `response`, как требует
авторизация навыков Алисы.

OAuth 2.0 связка аккаунтов для Яндекс Диалогов:

- authorization URL: `https://chaotika.ru/api/v1/oauth/alice/authorize`
- token URL: `https://chaotika.ru/api/v1/oauth/alice/token`
- redirect URI: `https://social.yandex.net/broker/redirect`
- credentials: `ALICE_OAUTH_CLIENT_ID` и `ALICE_OAUTH_CLIENT_SECRET`

`authorize` показывает backend-форму входа в Chaotika, выдает одноразовый
authorization code и редиректит обратно в Яндекс. `token` обменивает code или
refresh token на Chaotika-compatible JWT, который затем приходит в webhook как
`session.user.access_token`.

Команды Алисы разбираются гибридным парсером: явные сценарии покрывают быстрые
правила, а неочевидные фразы могут уходить в LLM fallback, если настроены
provider-neutral LLM параметры. По умолчанию fallback рассчитан на YandexGPT
Lite через OpenAI-compatible Chat Completions: `ALICE_LLM_PROVIDER=yandex`,
`ALICE_LLM_API_KEY` или `YANDEX_API_KEY`, и `ALICE_LLM_YANDEX_FOLDER_ID`
либо явный `ALICE_LLM_MODEL=gpt://<folder_ID>/yandexgpt-5-lite`. LLM возвращает
только структурированный intent, исполнение остается в backend-сервисах
Chaotika.

`/api/v1/life-spheres` - текущий основной API для сфер жизни. `projects`
остаются compatibility-моделью: web пока использует project-термины в части
внутреннего planner state, но запросы создания/списка сфер идут через
life-spheres API.

Важные настройки API:

- `DATABASE_URL` по умолчанию:
  `postgres://planner:planner@127.0.0.1:54329/planner_development`
- `API_STORAGE_DRIVER=postgres` - единственный application runtime; `memory`
  разрешен только в тестах
- `API_AUTH_MODE=disabled` - локальный legacy flow через
  `x-workspace-id`/`x-actor-user-id`; разрешен только в `development` и `test`
- `API_AUTH_MODE=jwt` - Chaotika Auth через email/password и собственные JWT
- production runtime требует `API_AUTH_MODE=jwt`, явный `API_CORS_ORIGIN`,
  неплейсхолдерный `AUTH_JWT_SECRET` и включенный RLS mode; с
  `API_DB_RLS_MODE=disabled` API не стартует
- `API_DB_RLS_MODE` переопределяет RLS strategy:
  `disabled`, `claims_only`, `enabled`, `transaction_local`,
  `session_connection`. `transaction_local` требует, чтобы runtime DB user мог
  `SET ROLE authenticated`; `claims_only` сохраняет JWT claims в DB context без
  переключения Postgres role
- `API_TRUST_PROXY_HOPS=1` явно доверяет одному reverse proxy hop; без этой
  настройки API не читает `x-forwarded-for` напрямую
- `API_TASK_REMINDERS_RUNTIME` управляет напоминаниями:
  `api` запускает poller внутри API процесса, `worker` запускает отдельный
  production systemd service `planner-task-reminders`, `disabled` полностью
  выключает poller
- по умолчанию backend передает DB RLS context через transaction-local settings;
  перед включением этого режима на production надо прогнать
  `npm run db:security:check` с production `DATABASE_URL` и `API_DB_RLS_MODE`
- `npm run smoke:api:prod` поднимает API локально с `NODE_ENV=production`,
  `API_AUTH_MODE=jwt`, `API_DB_RLS_MODE=transaction_local` и проверяет реальные
  `health`, `auth`, `session` и `tasks` запросы; перед запуском используйте
  `npm run db:setup`
- `API_ICON_ASSET_DIR` задает локальное хранилище загруженных иконок
- каждый ответ получает `x-request-id`; `/api/metrics` отдает lightweight
  runtime counters в Prometheus-compatible text format
- Android push через FCM включается, если API runtime видит либо
  `FIREBASE_SERVICE_ACCOUNT_PATH`, либо trio
  `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`

Для production Timeweb PostgreSQL используйте обычный `DATABASE_URL` с
`sslmode=require`.

## Web Runtime

Web-клиент работает через backend HTTP API и не пишет напрямую в Postgres.

- server state хранится в TanStack Query
- session резолвится через `GET /api/v1/session`
- Chaotika Auth включается через `VITE_AUTH_PROVIDER=planner`
- `VITE_API_ACCESS_TOKEN` можно использовать для локальной разработки против
  authenticated backend runtime
- `VITE_ACTOR_USER_ID` + `VITE_WORKSPACE_ID` принудительно задают legacy
  actor/workspace pair; если обе переменные пустые, session берется из API
- последние snapshots задач, сфер/compat projects и templates, а также очередь
  write-операций хранятся в IndexedDB через Dexie
- offline queue replay-ится через HTTP API; конфликты версий
  `task_version_conflict`, `project_version_conflict` и
  `life_sphere_version_conflict` остаются в конфликтном состоянии
- cursor sync читает `/api/v1/task-events`, хранит последний event id локально и
  инвалидирует query cache при новых событиях; polling включен по умолчанию

Текущие экраны: `/today`, `/shopping`, `/timeline`, `/spheres`,
`/spheres/:sphereId`, `/admin`.

## Mobile Runtime

Проект поддерживает два мобильных канала: installable `PWA` и нативную оболочку
через Capacitor.

Пошаговый end-to-end workflow от локальной разработки до production rollout
описан в [docs/release-workflow.md](docs/release-workflow.md).

- `PWA` использует `apps/web/public/manifest.webmanifest` и
  `apps/web/public/sw.js`
- service worker регистрируется только в production browser build и не
  включается внутри Capacitor webview
- Capacitor config лежит в `capacitor.config.ts`, а нативные проекты живут в
  `ios/` и `android/`
- исходник для нативных иконок и splash лежит в `assets/logo.png`; для
  регенерации используйте `npm run mobile:assets`
- для one-command подготовки native release используйте
  `npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2`
- для signed APK под RuStore сначала создайте `android/keystore.properties` по
  образцу `android/keystore.properties.example`, затем запускайте
  `npm run mobile:release:rustore -- --api-url=https://chaotika.ru --version=1.0.5 --build=5`
- для one-command сборки release-артефактов используйте, например,
  `npm run mobile:release -- --api-url=https://chaotika.ru --version=1.0.1 --build=2 --build-artifacts=all --android-format=both`
- для обновления нативных оболочек после изменений web используйте
  `npm run mobile:sync`
- для dev/staging/prod mobile-сборок `VITE_API_BASE_URL` должен указывать на
  API, доступный с устройства; `http://127.0.0.1:3001` работает только в
  браузере на той же машине, для Android emulator нужен `http://10.0.2.2:3001`,
  а для физического устройства обычно нужен публичный `https` URL
- production API CORS должен разрешать origin нативной оболочки Capacitor:
  минимум `https://localhost` для Android и `capacitor://localhost` для iOS
- для Android push нужно добавить Firebase Android app config в
  `android/app/google-services.json`, затем выполнить `npm run mobile:sync:android`
- Android-клиент сам регистрирует FCM token после входа в приложение и может
  принимать тестовый push через `POST /api/v1/push/test`

## Production Data Platform

Production-данные приложения живут в Timeweb Managed PostgreSQL, а backend
остается единственной точкой чтения и записи для UI.

- `db/migrations` - источник истины для SQL-схемы
- runner миграций хранит checksum и количество statements, берет advisory lock и
  падает при изменении уже примененной migration
- production deploy перед миграциями делает `pg_dump` backup в `/opt/planner/backups`
- `npm run db:security:check` проверяет, что protected tables остаются под RLS
- Auth полностью обслуживается backend: email/password, JWT, refresh tokens и
  password reset
- основной sync идет через polling `/api/v1/task-events` и backend API
- Storage подготовлен приватным bucket `task-attachments`; UI не пишет туда
  напрямую
- PGMQ/pg_cron hooks активируются условно при наличии расширений в PostgreSQL
- иконки emoji library сейчас хранятся локально через API в
  `API_ICON_ASSET_DIR`, а не во внешнем storage

## Production Deploy

Текущий production target описан в [DEPLOY_RU.md](DEPLOY_RU.md):

- домен `chaotika.ru`
- VPS `147.45.158.186`
- Caddy как HTTPS reverse proxy
- systemd service `planner-api`
- systemd service `planner-task-reminders`, если
  `API_TASK_REMINDERS_RUNTIME=worker`
- production env в `/etc/planner/planner.env`
- web build обслуживается из `/opt/planner/apps/web/dist`
- загруженные иконки лежат в `/var/lib/planner/icon-assets`

После первичной подготовки сервера обновление выполняется командой:

```bash
npm run deploy:prod
```

## Документация

- [docs/shared-workspace.md](docs/shared-workspace.md) - модель `Shared
Workspace`: роли, права, жизненный цикл и правила обновления документации
- [docs/architecture.md](docs/architecture.md) - слои web-клиента и стратегия
  состояния
- [docs/release-workflow.md](docs/release-workflow.md) - пошаговый workflow от
  разработки до production web/PWA/store release
- [docs/adr/0001-platform-foundation.md](docs/adr/0001-platform-foundation.md)
  - базовое архитектурное решение по платформе
- [DEPLOY_RU.md](DEPLOY_RU.md) - production deployment на текущий VPS

## Контроль качества

- pre-commit hook запускает `lint-staged`
- CI запускает `npm run ci`
- CI дополнительно поднимает PostgreSQL, применяет миграции, запускает
  `npm run db:security:check`, `npm run test:api:postgres`,
  `npm run smoke:api:prod` и `npm run test:e2e`
- shared contracts валидируются через `zod`
- web unit-тесты запускаются через Vitest
- web coverage имеет минимальные thresholds в `apps/web/vite.config.ts`
- API тесты запускаются через встроенный Node test runner с `tsx`
- `npm run audit:prod` и `npm run audit:dev-tooling` должны оставаться чистыми;
  tooling для native assets запускается из isolated `npx`, чтобы не держать
  уязвимые transient dev-dependencies в lockfile
