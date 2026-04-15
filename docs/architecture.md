# Architecture

## Goals

- Keep feature work fast without letting the app collapse back into a single file.
- Separate pure domain logic from React and browser APIs.
- Make the next storage layer change survivable.

## Layers

### `app`

Application shell and global providers.

- router setup
- planner provider
- top-level layout

### `pages`

Route entry points.

Pages should compose widgets and features, but avoid business logic beyond selecting data for the screen.

### `widgets`

Reusable screen blocks that combine lower-level pieces.

Current example: sidebar.

### `features`

User actions and orchestration.

Current examples:

- planner state hook
- task composer

Feature code can depend on `entities` and `shared`.

### `entities`

Domain objects, selectors and pure task operations.

Current examples:

- task types
- sorting and grouping
- derived selectors for today, inbox, overdue
- task card and task section UI

### `shared`

Generic utilities and base UI.

Current examples:

- date helpers
- storage adapter
- class name helper
- page header

## Dependency direction

Dependencies should flow inward like this:

`app -> pages -> widgets -> features -> entities -> shared`

`shared` does not import from upper layers.
`entities` does not import from `features`, `widgets`, `pages` or `app`.

## State strategy

Right now the app uses a small React context backed by a custom hook and local storage.

This is intentional:

- global enough to remove prop drilling
- simple enough to avoid introducing a full state library too early
- ready to swap persistence later because storage is isolated

If sync or collaboration appears later, the first extension point is the storage adapter in `shared/lib/storage`.

## Testing strategy

- unit tests for pure domain logic in `entities`
- unit tests for shared utilities in `shared`
- component tests only for critical interactions
- e2e smoke tests later, after flows stabilize
