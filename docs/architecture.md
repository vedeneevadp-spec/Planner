# Архитектура web-клиента

`apps/web` использует feature-oriented структуру. Пути ниже указаны
относительно `apps/web/src`.

## Цели

- Сохранять скорость разработки экранов без возврата к одному большому файлу.
- Держать чистую доменную логику отдельно от React и браузерных API.
- Не привязывать UI к конкретному storage/runtime: web работает через backend
  HTTP API.
- Оставлять замену или расширение backend-модулей управляемой через contracts.

## Слои

### `app`

Composition root приложения.

- глобальные провайдеры
- router setup
- верхнеуровневый layout

### `pages`

Точки входа маршрутов.

Текущие страницы:

- `today` - фокус дня, ресурсный план и быстрые изменения задач
- `shopping` - общий список покупок поверх `chaos-inbox`
- `timeline` - задачи на временной линии
- `spheres` - список сфер жизни и недельный баланс
- `admin` - пользователи, настройки workspace и icon/emoji assets

Страницы собирают экран из widgets, features и entities. Бизнес-логику, которую
можно переиспользовать или тестировать отдельно, нужно выносить в `features`,
`entities` или локальный `lib` страницы.

### `widgets`

Переиспользуемые экранные блоки, которые комбинируют более низкоуровневые
части.

Текущий пример: `sidebar`.

### `features`

Пользовательские действия, orchestration-логика и интеграция с runtime.

Текущие примеры:

- `session` - Chaotika Auth, access token lifecycle и session query
- `planner` - planner provider, HTTP API client, TanStack Query state,
  optimistic mutations, offline queue и task-event cursor sync
- `task-create` - composer для создания задач
- `emoji-library` - загрузка и чтение custom icon assets
- `shopping-list` - API/query-обвязка списка покупок

Feature-код может зависеть от `entities` и `shared`.

### `entities`

Доменные объекты, чистые селекторы и UI-компоненты, не завязанные на конкретный
runtime.

Текущие примеры:

- `task` - типы, сортировка, группировка, selectors, task card/section
- `project` - compatibility-модель для сфер в старом planner state
- `emoji-set` - типы и glyph rendering
- `task-template` - типы templates

### `shared`

Универсальные утилиты, config и базовый UI.

Текущие примеры:

- `config/planner-api` - чтение Vite env и общие headers для API
- `lib/date` - date helpers
- `lib/classnames` - helper для class names
- `ui/Icon`, `ui/Page`, `ui/PageHeader`

## Направление зависимостей

Зависимости идут внутрь:

`app -> pages -> widgets -> features -> entities -> shared`

Правила:

- `shared` не импортирует верхние слои
- `entities` не импортирует `features`, `widgets`, `pages` и `app`
- `features` не импортирует `widgets`, `pages` и `app`
- кросс-срезовые импорты идут через публичный `index.ts` среза, например
  `@/features/planner`
- не импортировать внутренние пути другого среза вроде
  `@/features/planner/model/...`, если это не локальный код того же среза

## Стратегия состояния

Главный источник истины - backend API и PostgreSQL schema. Web хранит
только server-state cache, offline snapshots и очередь операций.

Текущий расклад:

- session сначала резолвится через `/api/v1/session`
- Chaotika Auth включается через `VITE_AUTH_PROVIDER=planner`
- данные задач, сфер, templates, inbox и daily plan читаются через backend API
- TanStack Query отвечает за server-state cache и invalidation
- planner feature держит optimistic mutations, чтобы UI-компоненты не зависели
  от HTTP details
- IndexedDB через Dexie хранит последние snapshots задач, spheres/compat
  projects, templates и offline mutation queue
- queued mutations replay-ятся через тот же backend API
- stale writes получают `409 task_version_conflict`,
  `409 project_version_conflict` или `409 life_sphere_version_conflict`
- cursor sync читает `/api/v1/task-events`, сохраняет последний обработанный id
  локально и инвалидирует query cache

Расширять runtime лучше в boundary-слоях:

- `features/session` - auth, session bootstrap, access token lifecycle
- `features/planner/lib/planner-api` - HTTP contract web -> API
- `features/planner/model/usePlannerState` - query/mutation orchestration
- `packages/contracts` - DTO и zod-схемы между web и API

## Сферы и compatibility projects

Пользовательская модель сейчас называется "сферы жизни" и ходит в backend через
`/api/v1/life-spheres`.

В web еще есть compatibility-термины `Project`/`projects` в planner state и
части UI props. Этот слой мапит `LifeSphereRecord` в `ProjectRecord`, чтобы не
ломать старые task components и offline cache за один большой рефактор.

Новую пользовательскую функциональность нужно проектировать вокруг сфер. Старые
project names допустимы только как compatibility boundary.

## Стратегия тестирования

- чистая доменная логика в `entities` и page `lib` покрывается unit-тестами
- API client, offline queue и session helpers покрываются web-тестами через
  Vitest
- backend modules и bootstrap покрываются Node test runner с `tsx`
- e2e smoke-тестов пока нет; добавлять их стоит после стабилизации основных
  пользовательских сценариев
