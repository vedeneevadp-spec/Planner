# Planner

Monorepo для planner-платформы: текущий `React`-клиент уже вынесен в `apps/web`, а репозиторий подготовлен под `api`, shared contracts и серверную Postgres-схему.

## Стек

- React 19
- React Router 7
- TypeScript в strict-режиме
- ESLint + Prettier
- Vitest
- Husky + lint-staged
- GitHub Actions CI

## Требования

- Node `24.14.0`
- npm `11.9.0`

Для выравнивания версии окружения используйте `.nvmrc` или `.node-version`.

## Скрипты

- `npm run dev` - локальный dev-сервер web-приложения из `apps/web`
- `npm run dev:supabase` - одновременный запуск web + api поверх managed Supabase Postgres с автоматическим подбором свободных локальных портов
- `npm run start` - алиас локального dev-запуска web-приложения
- `npm run dev:api` - запуск backend API в watch-режиме с локальным Postgres по умолчанию
- `npm run dev:api:postgres` - запуск backend API в watch-режиме с локальным Postgres
- `npm run dev:api:supabase` - запуск backend API с managed Supabase Postgres через `.env.supabase.local`
- `npm run start:api` - единичный запуск backend API с локальным Postgres по умолчанию
- `npm run start:api:postgres` - единичный запуск backend API с локальным Postgres
- `npm run start:api:supabase` - единичный запуск backend API с managed Supabase Postgres
- `npm run db:up` - поднять локальный Postgres через Docker Compose
- `npm run db:migrate` - применить SQL-миграции к локальной базе
- `npm run db:seed` - загрузить базовые dev-данные в локальную базу
- `npm run db:setup` - поднять базу, применить миграции и seed
- `npm run db:migrate:supabase` - применить SQL-миграции к managed Supabase Postgres
- `npm run db:seed:supabase` - загрузить базовые dev-данные в managed Supabase Postgres
- `npm run db:setup:supabase` - миграции + seed для managed Supabase Postgres
- `npm run outbox:run` - обработать pending/failed outbox-сообщения одной пачкой
- `npm run supabase:login` - логин в Supabase CLI через токен из `.env.supabase.local`
- `npm run supabase:link` - линковка локального репозитория с remote Supabase project
- `npm run lint` - статический анализ всего monorepo
- `npm run typecheck` - проверка `apps/web`, `apps/api` и `packages/contracts`
- `npm run test:api` - запуск backend API тестов
- `npm run test:run` - однократный запуск web и api тестов
- `npm run coverage` - запуск web-тестов с coverage-отчётом
- `npm run build` - production-сборка web-приложения
- `npm run check` - lint + typecheck + тесты
- `npm run ci` - полный локальный CI-пайплайн

## Структура проекта

```text
apps/
  web/        React/Vite клиент
  api/        backend-каркас и границы модулей
packages/
  contracts/  shared DTO и schema-контракты
supabase/
  migrations/ SQL-миграции под Postgres/Supabase
```

## Архитектура

- `apps/web` сохраняет текущую feature-oriented структуру `app/pages/widgets/features/entities/shared`
- `apps/api` уже содержит `Fastify` runtime, task routes, Postgres runtime boundary и memory adapter для тестов
- `packages/contracts` становится общей точкой типов и валидации между web и api
- `supabase/migrations` фиксирует серверную схему как главный источник истины

Подробные правила по слоям web-клиента описаны в [docs/architecture.md](docs/architecture.md).

## API Runtime

- По умолчанию API стартует на локальном Postgres и использует `DATABASE_URL`, либо fallback `postgres://planner:planner@127.0.0.1:54329/planner_development`.
- `API_STORAGE_DRIVER=memory` поддерживается только в тестовом runtime.
- `API_DB_RLS_MODE` можно использовать для override поведения RLS runtime layer: в auto-режиме direct Postgres включает DB RLS context, а Supabase pooler runtime отключает его из-за нестабильности transaction-scoped role switching.
- Базовые endpoint'ы уже доступны: `/api/health`, `/api/v1/session`, `/api/v1/tasks`, `/api/v1/task-events`.
- OpenAPI specification доступна на `/api/openapi.json`, Swagger UI - на `/api/docs`.
- Для managed Supabase runtime используйте `SUPABASE_RUNTIME_DATABASE_URL` или fallback на `SUPABASE_DB_URL`.
- Outbox worker запускается через `npm run outbox:run`; в production его можно дергать scheduler'ом поверх той же backend-конфигурации.

## Web Runtime

- `apps/web` работает только через HTTP API и server-state cache на `TanStack Query`.
- Для offline-first сценариев web хранит последний task snapshot и очередь write-операций в IndexedDB через `Dexie`.
- Offline queue синхронизируется автоматически при восстановлении сети и использует `expectedVersion`; серверные `409 task_version_conflict` оставляют операцию в конфликтном состоянии и обновляют query cache.
- Cursor sync читает `/api/v1/task-events`, хранит последний event id в IndexedDB и инвалидирует task cache при новых событиях или Supabase Realtime notification.
- Текущая session-модель резолвится сервером через `GET /api/v1/session`.
- Для локального запуска можно использовать значения из `apps/web/.env.example`.
- Если `VITE_ACTOR_USER_ID` и `VITE_WORKSPACE_ID` не заданы, web берет default session из API runtime.
- Если override-переменные заданы обе, web принудительно использует этот actor/workspace pair.

## Local Postgres

1. Выполните `npm run db:setup`.
2. Запустите API через `npm run dev:api`.
3. При необходимости скопируйте `apps/web/.env.example` в `apps/web/.env`.
4. По умолчанию `/api/v1/session` вернет первый доступный membership из базы.
5. Для явного override используйте seeded значения:
   `x-actor-user-id: 11111111-1111-4111-8111-111111111111`
   `x-workspace-id: 22222222-2222-4222-8222-222222222222`

## Supabase Platform

Сейчас Supabase подключается на инфраструктурном уровне, а не как direct data layer для frontend:

- `apps/api` остается единственной точкой записи и чтения данных для UI
- `supabase/migrations` остается главным источником SQL-схемы
- Supabase CLI добавлен для project linking и дальнейших platform workflows
- Auth подключается через Supabase JWT verification на backend boundary
- Realtime подключен к `app.task_events`; web только слушает notification и затем синхронизируется через backend API
- Storage подготовлен приватным bucket `task-attachments` и state table `app.task_attachments`; UI не пишет напрямую в Storage
- Queue/Cron hooks условно активируются в managed Supabase: task events зеркалятся в PGMQ queue `planner_task_events`, а pg_cron может чистить completed outbox

### Подготовка окружения

1. Скопируйте `.env.supabase.example` в `.env.supabase.local`.
2. Заполните `SUPABASE_DB_URL` для migrations и admin tooling.
3. Заполните `SUPABASE_RUNTIME_DATABASE_URL` transaction pooler string на `:6543` для backend runtime.
4. При необходимости добавьте `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` и `SUPABASE_DB_PASSWORD` для CLI-команд.

### Cutover На Stage 1

1. Выполните `npm run db:migrate:supabase`.
2. Выполните `npm run db:seed:supabase`.
3. Для полного локального стека используйте `npm run dev:supabase`.
4. Если нужен только backend, используйте `npm run dev:api:supabase`.
5. Web продолжает работать только через backend HTTP API.

### One-Command Dev Flow

1. Скопируйте `.env.supabase.example` в `.env.supabase.local` и заполните значения.
2. При первом подключении выполните `npm run db:setup:supabase`.
3. Запустите `npm run dev:supabase`.
4. Скрипт сам подберет свободные локальные порты для API и web и выведет их в консоль.
5. Если нужно явно зафиксировать actor/workspace в web, скопируйте `apps/web/.env.example` в `apps/web/.env`.

### Почему два connection string

- `SUPABASE_DB_URL` нужен для migrations, seed и прочих admin-операций. Если direct host из вашей сети недоступен, можно временно использовать тот же pooler URL, что и для runtime.
- `SUPABASE_RUNTIME_DATABASE_URL` нужен для backend runtime. Для этого проекта рабочий вариант - Supavisor transaction pooler на `:6543`.
- `SUPABASE_SESSION_POOLER_URL` оставлен как backward-compatible alias для старых локальных env-файлов.

## Контроль качества

- pre-commit hook запускает `lint-staged`
- CI запускает `npm run ci`
- shared contracts валидируются через `zod`
- доменная логика web-части покрыта unit-тестами
