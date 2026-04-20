# ADR 0001: Platform Foundation

## Status

Accepted

## Decision

Платформа развивается как monorepo со следующими базовыми частями:

- `apps/web` для пользовательского React-клиента
- `apps/api` для backend modular monolith
- `packages/contracts` для shared DTO и schema-контрактов
- `supabase/migrations` для SQL-first схемы Postgres/Supabase
- `task_events` + `outbox` для sync/integration trail без pure event sourcing

## Rationale

- web и api должны разделять контракты, но не внутренние модели и репозитории
- база данных становится источником истины, а не browser storage
- repo должен быть готов к multi-device sync, background jobs и realtime без второго большого рефактора структуры
- UI не пишет напрямую в Postgres/Supabase Storage; все доменные записи проходят через backend boundary

## Consequences

- локальный web storage остается только временной совместимостью и импортным источником
- новые фичи сначала проектируются как contracts + DB schema + api boundary, а уже потом как UI state
- серверные инварианты будут жить в `apps/api` и SQL-схеме, а не в React context
- Supabase используется как managed platform вокруг Postgres, но frontend не получает прямой write access в базу
- frontend может использовать IndexedDB только как offline cache/queue, а не как источник истины
