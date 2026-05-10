# 2026-05-10 production 500 after RLS mode change

## Impact

After deploy, authenticated production API requests returned HTTP 500 while
`/api/health` stayed green.

Affected examples:

- `GET /api/v1/tasks`
- `GET /api/v1/life-spheres`
- `GET /api/v1/emoji-sets`
- `GET /api/v1/task-templates`
- `GET /api/v1/chaos-inbox`

## Root Cause

Production was switched from `API_DB_RLS_MODE=disabled` to
`API_DB_RLS_MODE=transaction_local`.

In `transaction_local` mode the API sets `request.jwt.claims` and then runs:

```sql
set local role authenticated;
```

The production database runtime user can connect and query the database, but it
is not a member of the Postgres role `authenticated` and cannot `SET ROLE
authenticated`. Postgres rejected every authenticated request with:

```text
permission denied to set role "authenticated"
```

The release checks missed this because the production health check only tested
basic database connectivity, and the production smoke test was run against a
local API process instead of the already deployed API process with real server
environment.

## Fix

Current production uses `API_DB_RLS_MODE=claims_only`.

This mode still passes JWT claims into the database transaction, but does not
run `SET ROLE authenticated`. It is a compatibility mode for managed database
users that cannot switch Postgres roles.

Full DB-enforced RLS can be enabled later by switching back to
`transaction_local` after the database administrator grants the runtime DB role
permission to set role `authenticated`, or after introducing a dedicated
runtime DB role designed for that.

## Prevention

- `npm run db:security:check` now fails for `transaction_local` if the runtime
  DB user cannot `SET ROLE authenticated`.
- Production deploy now passes `NODE_ENV` and `API_DB_RLS_MODE` into
  `db:security:check`.
- Production deploy now runs `npm run smoke:api:prod` against the already
  running API at `http://127.0.0.1:3001`, so authenticated endpoints are checked
  before the release is considered healthy.
- Unknown `API_DB_RLS_MODE` values are rejected during API startup.
