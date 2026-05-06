# Planner

Monorepo для Planner/Chaotika: React-клиент, Fastify API, shared contracts и
SQL-first схема Postgres/Supabase.

## Стек

- React 19, React Router 7, Vite 8
- TypeScript strict mode
- Fastify 5, Kysely, PostgreSQL
- Supabase Auth/Realtime/CLI как managed platform вокруг Postgres
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
npm run db:setup
npm run dev:api
npm run dev
```

`npm run dev:api` поднимает API на `http://127.0.0.1:3001`, а `npm run dev`
поднимает web через Vite. Значения для web можно взять из
`apps/web/.env.example`; без `.env` клиент использует локальный API по
умолчанию.

Managed Supabase:

```bash
cp .env.supabase.example .env.supabase.local
npm run db:setup:supabase
npm run dev:supabase
```

`dev:supabase` запускает API и web вместе, подбирает свободные локальные порты и
передает web Supabase Auth config из `.env.supabase.local`.

## Основные скрипты

Полный список находится в `package.json`.

| Команда                                            | Назначение                                             |
| -------------------------------------------------- | ------------------------------------------------------ |
| `npm run dev` / `npm run start`                    | dev-сервер web-приложения                              |
| `npm run preview`                                  | preview production-сборки web                          |
| `npm run dev:supabase`                             | web + API поверх managed Supabase Postgres             |
| `npm run dev:api`                                  | API в watch-режиме                                     |
| `npm run dev:api:postgres`                         | API с локальным Docker Postgres                        |
| `npm run dev:api:supabase`                         | API с `.env.supabase.local`                            |
| `npm run start:api`                                | единичный запуск API                                   |
| `npm run db:up` / `npm run db:down`                | поднять/остановить локальный Postgres                  |
| `npm run db:migrate` / `npm run db:seed`           | применить миграции и dev seed локально                 |
| `npm run db:setup`                                 | `db:up` + migrations + seed                            |
| `npm run db:migrate:supabase`                      | применить SQL-миграции к Supabase Postgres             |
| `npm run db:push:supabase`                         | выполнить `supabase db push` через локальный wrapper   |
| `npm run db:seed:supabase`                         | загрузить seed в Supabase Postgres                     |
| `npm run db:setup:supabase`                        | migrations + seed для Supabase                         |
| `npm run supabase:login` / `npm run supabase:link` | CLI login/link через env                               |
| `npm run outbox:run`                               | обработать одну пачку outbox-сообщений                 |
| `npm run lint` / `npm run lint:fix`                | ESLint                                                 |
| `npm run format:check` / `npm run format`          | Prettier                                               |
| `npm run typecheck`                                | typecheck web, contracts и API                         |
| `npm run test:web:run` / `npm run test:api`        | web/API тесты                                          |
| `npm run test:run`                                 | web + API тесты                                        |
| `npm run coverage`                                 | web coverage                                           |
| `npm run build`                                    | production-сборка web                                  |
| `npm run mobile:sync`                              | production build web + sync в `ios/` и `android/`      |
| `npm run mobile:release -- --api-url=...`          | подготовить и при флагах собрать native release        |
| `npm run mobile:release:rustore -- --api-url=...`  | собрать signed APK для RuStore                         |
| `npm run mobile:assets`                            | пересобрать нативные icons/splash из `assets/logo.png` |
| `npm run mobile:open:ios` / `mobile:open:android`  | открыть нативный проект в Xcode / Android Studio       |
| `npm run mobile:doctor`                            | проверить состояние Capacitor toolchain                |
| `npm run check`                                    | lint + typecheck + tests                               |
| `npm run ci`                                       | локальный CI: check + build                            |
| `npm run deploy:prod`                              | production deploy на текущий VPS                       |

## Структура

```text
apps/
  web/         React/Vite клиент
  api/         Fastify API и backend-модули
packages/
  contracts/   shared DTO, zod-схемы и API-контракты
supabase/
  migrations/  SQL-миграции Postgres/Supabase
deploy/
  caddy/       production Caddyfile
  systemd/     production systemd unit для API
scripts/       локальные, Supabase и deploy workflows
```

## API Runtime

API строится как modular monolith поверх Fastify. Основные route-группы:

- public: `/api/health`, `/api/openapi.json`, `/api/docs`,
  `/api/v1/icon-assets/:fileName`
- session: `/api/v1/session`
- planner: `/api/v1/tasks`, `/api/v1/task-events`
- сферы: `/api/v1/life-spheres`, `/api/v1/life-spheres/weekly-stats`
- compatibility project API: `/api/v1/projects`
- templates: `/api/v1/task-templates`
- capture: `/api/v1/chaos-inbox`
- daily planning: `/api/v1/daily-plan`
- emoji/icon library: `/api/v1/emoji-sets`

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
  `x-workspace-id`/`x-actor-user-id`
- `API_AUTH_MODE=supabase` - bearer token из Supabase Auth, workspace передается
  через `x-workspace-id`
- `API_DB_RLS_MODE` переопределяет RLS strategy:
  `disabled`, `enabled`, `transaction_local`, `session_connection`
- Supabase transaction pooler runtime по умолчанию отключает DB RLS context,
  backend policies остаются обязательным первым уровнем защиты
- `API_ICON_ASSET_DIR` задает локальное хранилище загруженных иконок
- Android push через FCM включается, если API runtime видит либо
  `FIREBASE_SERVICE_ACCOUNT_PATH`, либо trio
  `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`

Для managed Supabase runtime используйте `SUPABASE_RUNTIME_DATABASE_URL`; если
он не задан, scripts берут fallback из `SUPABASE_DB_URL` или legacy
`SUPABASE_SESSION_POOLER_URL`.

## Web Runtime

Web-клиент работает через backend HTTP API и не пишет напрямую в Supabase.

- server state хранится в TanStack Query
- session резолвится через `GET /api/v1/session`
- Supabase browser auth включается только если заданы
  `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`
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
  инвалидирует query cache при новых событиях

Текущие экраны: `/today`, `/timeline`, `/inbox`, `/spheres`,
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
  `npm run mobile:release:rustore -- --api-url=https://chaotika.ru --version=1.0.3 --build=3`
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

## Supabase Platform

Supabase используется как managed platform, но backend остается единственной
точкой чтения и записи для UI.

- `supabase/migrations` - источник истины для SQL-схемы
- Supabase Auth проверяется на backend boundary
- Realtime notification используется как сигнал для последующей синхронизации
  через backend API
- Storage подготовлен приватным bucket `task-attachments`; UI не пишет туда
  напрямую
- PGMQ/pg_cron hooks активируются условно в managed Supabase migrations
- иконки emoji library сейчас хранятся локально через API в
  `API_ICON_ASSET_DIR`, а не в Supabase Storage

## Production Deploy

Текущий production target описан в [DEPLOY_RU.md](DEPLOY_RU.md):

- домен `chaotika.ru`
- VPS `147.45.158.186`
- Caddy как HTTPS reverse proxy
- systemd service `planner-api`
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
- shared contracts валидируются через `zod`
- web unit-тесты запускаются через Vitest
- API тесты запускаются через встроенный Node test runner с `tsx`
