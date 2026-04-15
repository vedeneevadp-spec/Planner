# Planner

Personal planning app on `Vite + React + TypeScript` with a deliberate foundation pass before feature work starts.

## Stack

- React 19
- React Router 7
- TypeScript in strict mode
- ESLint + Prettier
- Vitest
- Husky + lint-staged
- GitHub Actions CI

## Requirements

- Node `24.14.0`
- npm `11.9.0`

Use `.nvmrc` or `.node-version` to align the runtime.

## Scripts

- `npm run dev` - local development server
- `npm run lint` - static analysis
- `npm run typecheck` - TypeScript validation
- `npm run test:run` - run unit tests once
- `npm run build` - production build
- `npm run check` - lint + typecheck + tests
- `npm run ci` - full local CI pipeline

## Project layout

```text
src/
  app/        app shell, providers, router
  pages/      route-level pages
  widgets/    reusable route widgets
  features/   user actions and state orchestration
  entities/   domain model and task UI
  shared/     cross-cutting libs and UI primitives
```

## Architecture

Short version: `pages` compose UI, `features` mutate state, `entities` own task domain logic, `shared` contains generic utilities.

See [docs/architecture.md](docs/architecture.md) for the detailed layer rules.

## Quality gates

- pre-commit hook runs `lint-staged`
- CI runs `npm run ci`
- local persistence is schema-validated with `zod`
- domain logic has unit tests
