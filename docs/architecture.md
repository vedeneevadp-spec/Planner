# Архитектура

## Цели

- Сохранить высокую скорость разработки фич, не скатываясь обратно в один большой файл.
- Отделить чистую доменную логику от React и браузерных API.
- Сделать следующую замену слоя хранения данных управляемой.

Web-клиент находится в `apps/web`, поэтому пути ниже описаны относительно `apps/web/src`.

## Слои

### `app`

Каркас приложения и глобальные провайдеры.

- настройка роутера
- composition root
- верхнеуровневый layout

### `pages`

Точки входа маршрутов.

Страницы должны собирать экран из widgets и features, но не содержать бизнес-логику, кроме выбора данных для конкретного экрана.

### `widgets`

Переиспользуемые экранные блоки, которые комбинируют более низкоуровневые части.

Текущий пример: sidebar.

### `features`

Пользовательские действия, orchestration-логика и интеграция с API/runtime.

Текущие примеры:

- planner provider и context hook
- session query для резолва текущего actor/workspace
- query/mutation слой planner поверх HTTP API
- composer для создания задач

Feature-код может зависеть от `entities` и `shared`.

### `entities`

Доменные объекты, селекторы и чистые операции над задачами.

Текущие примеры:

- типы задач
- сортировка и группировка
- производные селекторы для today, inbox и overdue
- UI-компоненты task card и task section

### `shared`

Универсальные утилиты и базовый UI.

Текущие примеры:

- date helpers
- helper для class names
- page header

## Направление зависимостей

Зависимости должны идти внутрь по такой схеме:

`app -> pages -> widgets -> features -> entities -> shared`

`shared` не импортирует код из верхних слоёв.
`entities` не импортирует код из `features`, `widgets`, `pages` и `app`.
Кросс-срезовые импорты идут только через публичный `index.ts` среза, например `@/features/planner`, а не через внутренние пути вроде `@/features/planner/model/...`.

## Стратегия состояния

Сейчас приложение использует `React Query` как server-state слой и небольшой React context как фасад над planner-операциями для UI.

Текущий расклад такой:

- session клиента сначала резолвится через `/api/v1/session`
- данные задач живут на API и кэшируются на клиенте через query cache
- оптимистичные мутации остаются в feature-слое, поэтому UI не зависит напрямую от HTTP-клиента
- последний task snapshot и offline mutation queue хранятся в IndexedDB через `Dexie`
- queued мутации replay-ятся через тот же HTTP API; stale writes получают `409 task_version_conflict`

Первая точка расширения теперь находится не в browser storage, а в boundary `features/session` и `features/planner/lib/planner-api`, где можно добавлять auth, multi-workspace switching, pagination, realtime sync и offline rehydration без переписывания экранов.

## Стратегия тестирования

- unit-тесты для чистой доменной логики в `entities`
- unit-тесты для общих утилит в `shared`
- компонентные тесты только для критичных взаимодействий
- e2e smoke-тесты позже, когда пользовательские сценарии стабилизируются
