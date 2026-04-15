# Planner

Приложение для личного планирования на `Vite + React + TypeScript` с аккуратно выделенной базовой архитектурой до активной фичевой разработки.

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

- `npm run dev` - локальный dev-сервер, при запуске автоматически открывает приложение в браузере
- `npm run start` - алиас локального dev-запуска с автооткрытием браузера
- `npm run lint` - статический анализ
- `npm run typecheck` - проверка TypeScript
- `npm run test:run` - однократный запуск unit-тестов
- `npm run coverage` - запуск тестов с coverage-отчётом в `coverage/`
- `npm run build` - production-сборка
- `npm run check` - lint + typecheck + тесты
- `npm run ci` - полный локальный CI-пайплайн

## Структура проекта

```text
src/
  app/        каркас приложения, провайдеры, роутер
  pages/      страницы уровня маршрутов
  widgets/    переиспользуемые экранные блоки
  features/   пользовательские действия и orchestration-логика
  entities/   доменная модель и UI задач
  shared/     общие утилиты и базовые UI-примитивы
```

## Архитектура

Коротко: `pages` собирают экран, `features` управляют действиями и изменением состояния, `entities` содержат доменную логику задач, `shared` хранит универсальные утилиты.

Подробные правила по слоям описаны в [docs/architecture.md](docs/architecture.md).

## Контроль качества

- pre-commit hook запускает `lint-staged`
- CI запускает `npm run ci`
- локальное хранилище валидируется через `zod`
- доменная логика покрыта unit-тестами
